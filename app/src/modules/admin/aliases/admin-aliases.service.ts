import { Injectable } from "@nestjs/common";

import { isDuplicateEntry } from "../../../shared/database/database.utils.js";
import { PublicHttpException } from "../../../shared/errors/public-http.exception.js";
import { DatabaseService } from "../../../shared/database/database.service.js";
import {
  parseMailbox,
} from "../../../shared/validation/mailbox.js";
import { BanPolicyService } from "../../bans/ban-policy.service.js";
import { AdminAliasesRepository } from "./admin-aliases.repository.js";
import type { AdminAliasRow } from "./admin-aliases.repository.js";
import { AdminDomainsRepository } from "../domains/admin-domains.repository.js";
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

        const domainRow = await this.adminDomainsRepository.getActiveByName(
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
    try {
      const row = await this.database.withTransaction(async (connection) => {
        const current = await this.adminAliasesRepository.getById(id, connection, {
          forUpdate: true,
        });
        if (!current) {
          throw new PublicHttpException(404, { error: "alias_not_found", id });
        }

        const patch: { address?: string; goto?: string; active?: number } = {};
        let nextAddress = String(current.address || "").trim().toLowerCase();
        let nextGoto = String(current.goto || "").trim().toLowerCase();
        let addressChanged = false;
        let gotoChanged = false;

        if (dto.address !== undefined) {
          const parsed = parseMailbox(dto.address);
          if (!parsed) {
            throw new PublicHttpException(400, {
              error: "invalid_params",
              field: "address",
            });
          }

          if (parsed.email !== nextAddress) {
            const reservedHandle = await this.adminAliasesRepository.existsReservedHandle(
              parsed.local,
              connection,
              { forUpdate: true },
            );
            if (reservedHandle) {
              throw new PublicHttpException(409, {
                ok: false,
                error: "alias_taken",
                address: parsed.email,
              });
            }

            const domainRow = await this.adminDomainsRepository.getActiveByName(
              parsed.domain,
              connection,
            );
            if (!domainRow) {
              throw new PublicHttpException(400, {
                error: "invalid_domain",
                field: "address",
              });
            }

            const existing = await this.adminAliasesRepository.getByAddress(
              parsed.email,
              connection,
              { forUpdate: true },
            );
            if (existing && Number(existing.id) !== id) {
              throw new PublicHttpException(409, {
                ok: false,
                error: "alias_taken",
                address: parsed.email,
              });
            }
          }

          patch.address = parsed.email;
          nextAddress = parsed.email;
          addressChanged = true;
        }

        if (dto.goto !== undefined) {
          const parsed = parseMailbox(dto.goto);
          if (!parsed) {
            throw new PublicHttpException(400, {
              error: "invalid_params",
              field: "goto",
            });
          }

          patch.goto = parsed.email;
          nextGoto = parsed.email;
          gotoChanged = true;
        }

        if (dto.active !== undefined) {
          patch.active = dto.active;
        }

        const nextActive =
          patch.active === 0 || patch.active === 1 ? patch.active : Number(current.active || 0);

        const nextParsedAddress = parseMailbox(nextAddress);
        const nextParsedGoto = parseMailbox(nextGoto);
        if (!nextParsedAddress || !nextParsedGoto) {
          throw new PublicHttpException(500, {
            error: "invalid_current_state",
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

        if (Object.keys(patch).length === 0) {
          throw new PublicHttpException(400, {
            error: "invalid_params",
            reason: "empty_patch",
          });
        }

        await this.adminAliasesRepository.updateById(id, patch, connection);
        return this.adminAliasesRepository.getById(id, connection);
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

      const deleted = await this.adminAliasesRepository.deactivateById(id, connection);
      const item = await this.adminAliasesRepository.getById(id, connection);

      return {
        deleted: Boolean(deleted),
        item: item ?? current,
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
