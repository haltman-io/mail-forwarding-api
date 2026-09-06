import { Injectable } from "@nestjs/common";

import { isDuplicateEntry } from "../../../shared/database/database.utils.js";
import { PublicHttpException } from "../../../shared/errors/public-http.exception.js";
import { DatabaseService } from "../../../shared/database/database.service.js";
import { withLocalPartRoutingLock } from "../../../shared/database/local-part-routing-lock.js";
import {
  parseMailbox,
  type ParsedMailbox,
} from "../../../shared/validation/mailbox.js";
import { BanPolicyService } from "../../bans/ban-policy.service.js";
import { AdminAliasesRepository } from "./admin-aliases.repository.js";
import type { AdminAliasRow } from "./admin-aliases.repository.js";
import { AdminDomainsRepository } from "../domains/admin-domains.repository.js";
import { AdminCreationNotificationService } from "../utils/admin-creation-notification.service.js";
import type {
  AdminAliasesListQueryDto,
  AdminCreateAliasDto,
  AdminUpdateAliasDto,
} from "../dto/admin.dto.js";

@Injectable()
export class AdminAliasesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly adminAliasesRepository: AdminAliasesRepository,
    private readonly adminDomainsRepository: AdminDomainsRepository,
    private readonly banPolicyService: BanPolicyService,
    private readonly creationNotificationService: AdminCreationNotificationService,
  ) {}

  async listAliases(query: AdminAliasesListQueryDto): Promise<{
    items: Awaited<ReturnType<AdminAliasesRepository["listAll"]>>;
    pagination: { total: number; limit: number; offset: number };
  }> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const [items, total] = await Promise.all([
      this.adminAliasesRepository.listAll({
        limit,
        offset,
        active: query.active,
        goto: query.goto,
        domain: query.domain,
        handle: query.handle,
        address: query.address,
      }),
      this.adminAliasesRepository.countAll({
        active: query.active,
        goto: query.goto,
        domain: query.domain,
        handle: query.handle,
        address: query.address,
      }),
    ]);

    return {
      items,
      pagination: { total, limit, offset },
    };
  }

  async getAliasById(id: number): Promise<{ item: AdminAliasRow }> {
    const row = await this.adminAliasesRepository.getById(id);
    if (!row) {
      throw new PublicHttpException(404, { error: "alias_not_found", id });
    }

    return { item: row };
  }

  async createAlias(dto: AdminCreateAliasDto): Promise<{
    ok: true;
    created: true;
    item: AdminAliasRow | null;
  }> {
    const address = parseMailbox(dto.address);
    if (!address) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "address" });
    }

    const goto = parseMailbox(dto.goto);
    if (!goto) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "goto" });
    }

    const active = dto.active === undefined ? 1 : dto.active;
    await this.ensureAliasBans(address.local, address.domain, goto.email);

    try {
      const row = await this.database.withTransaction(async (connection) => {
        return withLocalPartRoutingLock(connection, address.local, async () => {
          const reservedHandle = await this.adminAliasesRepository.existsReservedHandle(
            address.local,
            connection,
            { forUpdate: true },
          );
          if (reservedHandle) {
            throw new PublicHttpException(409, {
              ok: false,
              error: "alias_taken",
              address: address.email,
            });
          }

          const domainRow = await this.adminDomainsRepository.getEmailValidByName(
            address.domain,
            connection,
          );
          if (!domainRow) {
            throw new PublicHttpException(400, {
              error: "invalid_domain",
              field: "address",
            });
          }

          const existing = await this.adminAliasesRepository.getByAddress(
            address.email,
            connection,
            { forUpdate: true },
          );
          if (existing) {
            throw new PublicHttpException(409, {
              ok: false,
              error: "alias_taken",
              address: address.email,
            });
          }

          const created = await this.adminAliasesRepository.createAlias(
            {
              address: address.email,
              goto: goto.email,
              active,
            },
            connection,
          );

          return created.insertId
            ? this.adminAliasesRepository.getById(created.insertId, connection)
            : null;
        });
      });

      this.creationNotificationService.notifyAliasCreated({
        aliasAddress: address.email,
        gotoEmail: goto.email,
      });

      return { ok: true, created: true, item: row };
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw new PublicHttpException(409, {
          ok: false,
          error: "alias_taken",
          address: address.email,
        });
      }
      throw error;
    }
  }

  async updateAlias(
    id: number,
    dto: AdminUpdateAliasDto,
  ): Promise<{ ok: true; updated: true; item: AdminAliasRow | null }> {
    let requestedAddress: ParsedMailbox | undefined;
    if (dto.address !== undefined) {
      const parsed = parseMailbox(dto.address);
      if (!parsed) {
        throw new PublicHttpException(400, {
          error: "invalid_params",
          field: "address",
        });
      }
      requestedAddress = parsed;
    }

    let requestedGoto: ParsedMailbox | undefined;
    if (dto.goto !== undefined) {
      const parsed = parseMailbox(dto.goto);
      if (!parsed) {
        throw new PublicHttpException(400, {
          error: "invalid_params",
          field: "goto",
        });
      }
      requestedGoto = parsed;
    }

    try {
      const row = await this.database.withTransaction(async (connection) => {
        const snapshot = await this.adminAliasesRepository.getById(id, connection);
        if (!snapshot) {
          throw new PublicHttpException(404, { error: "alias_not_found", id });
        }

        const snapshotAddress = parseMailbox(snapshot.address);
        if (!snapshotAddress) {
          throw new PublicHttpException(500, {
            error: "invalid_current_state",
          });
        }
        const snapshotGoto = parseMailbox(snapshot.goto);
        if (!snapshotGoto) {
          throw new PublicHttpException(500, {
            error: "invalid_current_state",
          });
        }

        const snapshotActive =
          dto.active === 0 || dto.active === 1 ? dto.active : Number(snapshot.active || 0);
        const lockLocalPart = requestedAddress?.local ?? snapshotAddress.local;
        let hasRoutingLock = false;

        const update = async () => {
          const current = await this.adminAliasesRepository.getById(id, connection, {
            forUpdate: true,
          });
          if (!current) {
            throw new PublicHttpException(404, { error: "alias_not_found", id });
          }

          const currentAddress = parseMailbox(current.address);
          const currentGoto = parseMailbox(current.goto);
          if (!currentAddress || !currentGoto) {
            throw new PublicHttpException(500, {
              error: "invalid_current_state",
            });
          }

          const patch: { address?: string; goto?: string; active?: number } = {};
          let nextParsedAddress = currentAddress;
          let nextParsedGoto = currentGoto;
          let addressChanged = false;
          let gotoChanged = false;

          if (requestedAddress !== undefined) {
            if (requestedAddress.email !== currentAddress.email) {
              const domainRow = await this.adminDomainsRepository.getEmailValidByName(
                requestedAddress.domain,
                connection,
              );
              if (!domainRow) {
                throw new PublicHttpException(400, {
                  error: "invalid_domain",
                  field: "address",
                });
              }

              const existing = await this.adminAliasesRepository.getByAddress(
                requestedAddress.email,
                connection,
                { forUpdate: true },
              );
              if (existing && Number(existing.id) !== id) {
                throw new PublicHttpException(409, {
                  ok: false,
                  error: "alias_taken",
                  address: requestedAddress.email,
                });
              }
            }

            patch.address = requestedAddress.email;
            nextParsedAddress = requestedAddress;
            addressChanged = true;
          }

          if (requestedGoto !== undefined) {
            patch.goto = requestedGoto.email;
            nextParsedGoto = requestedGoto;
            gotoChanged = true;
          }

          if (dto.active !== undefined) {
            patch.active = dto.active;
          }

          const nextActive =
            patch.active === 0 || patch.active === 1 ? patch.active : Number(current.active || 0);

          if (Object.keys(patch).length === 0) {
            throw new PublicHttpException(400, {
              error: "invalid_params",
              reason: "empty_patch",
            });
          }

          if (nextActive === 1 && nextParsedAddress.local !== lockLocalPart) {
            throw new PublicHttpException(409, {
              ok: false,
              error: "alias_state_changed",
              reason: "alias_local_part_changed",
            });
          }

          if (nextActive === 1 && !hasRoutingLock) {
            throw new PublicHttpException(409, {
              ok: false,
              error: "alias_state_changed",
              reason: "alias_active_state_changed",
            });
          }

          if (addressChanged || gotoChanged || nextActive === 1) {
            if (nextActive === 1) {
              const reservedHandle = await this.adminAliasesRepository.existsReservedHandle(
                nextParsedAddress.local,
                connection,
                { forUpdate: true },
              );
              if (reservedHandle) {
                throw new PublicHttpException(409, {
                  ok: false,
                  error: "alias_taken",
                  address: nextParsedAddress.email,
                });
              }
            }

            await this.ensureAliasBans(
              nextParsedAddress.local,
              nextParsedAddress.domain,
              nextParsedGoto.email,
            );
          }

          await this.adminAliasesRepository.updateById(id, patch, connection);
          return this.adminAliasesRepository.getById(id, connection);
        };

        return snapshotActive === 1
          ? withLocalPartRoutingLock(connection, lockLocalPart, async () => {
              hasRoutingLock = true;
              return update();
            })
          : update();
      });

      return { ok: true, updated: true, item: row };
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw new PublicHttpException(409, { ok: false, error: "alias_taken" });
      }
      throw error;
    }
  }

  async deleteAlias(id: number): Promise<{
    ok: true;
    deleted: boolean;
    item: AdminAliasRow;
  }> {
    const result = await this.database.withTransaction(async (connection) => {
      const current = await this.adminAliasesRepository.getById(id, connection, {
        forUpdate: true,
      });
      if (!current) {
        throw new PublicHttpException(404, { error: "alias_not_found", id });
      }

      const deleted = await this.adminAliasesRepository.deleteById(id, connection);

      return {
        deleted: Boolean(deleted),
        item: current,
      };
    });

    return { ok: true, ...result };
  }

  private async ensureAliasBans(
    localPart: string,
    domain: string,
    gotoEmail: string,
  ): Promise<void> {
    const banName = await this.banPolicyService.findActiveNameBan(localPart);
    if (banName) {
      throw new PublicHttpException(403, { error: "banned", ban: banName });
    }

    const banDomain = await this.banPolicyService.findActiveDomainBan(domain);
    if (banDomain) {
      throw new PublicHttpException(403, { error: "banned", ban: banDomain });
    }

    const banGoto = await this.banPolicyService.findActiveEmailOrDomainBan(gotoEmail);
    if (banGoto) {
      throw new PublicHttpException(403, { error: "banned", ban: banGoto });
    }
  }

}
