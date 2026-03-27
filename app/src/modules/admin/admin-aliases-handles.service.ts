import { Injectable } from "@nestjs/common";

import { PublicHttpException } from "../../shared/errors/public-http.exception.js";
import { DatabaseService } from "../../shared/database/database.service.js";
import {
  isValidLocalPart,
  parseMailbox,
  normalizeLowerTrim,
} from "../../shared/validation/mailbox.js";
import { BanPolicyService } from "../bans/ban-policy.service.js";
import { AdminAliasesRepository } from "./admin-aliases.repository.js";
import { AdminDomainsRepository } from "./admin-domains.repository.js";
import { AdminHandlesRepository } from "./admin-handles.repository.js";
import type {
  AdminAliasesListQueryDto,
  AdminCreateAliasDto,
  AdminCreateHandleDto,
  AdminHandlesListQueryDto,
  AdminUpdateAliasDto,
  AdminUpdateHandleDto,
} from "./admin.dto.js";
import { parsePositiveInt } from "./admin.utils.js";

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

  async getAliasById(idRaw: unknown): Promise<{ item: unknown }> {
    const id = parsePositiveInt(idRaw);
    if (!id) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "id" });
    }

    const row = await this.adminAliasesRepository.getById(id);
    if (!row) {
      throw new PublicHttpException(404, { error: "alias_not_found", id });
    }

    return { item: row };
  }

  async createAlias(dto: AdminCreateAliasDto): Promise<{
    ok: true;
    created: true;
    item: unknown;
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
      if (this.isDuplicateEntry(error)) {
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
    idRaw: unknown,
    dto: AdminUpdateAliasDto,
  ): Promise<{ ok: true; updated: true; item: unknown }> {
    const id = parsePositiveInt(idRaw);
    if (!id) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "id" });
    }

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
      if (this.isDuplicateEntry(error)) {
        throw new PublicHttpException(409, { ok: false, error: "alias_taken" });
      }
      throw error;
    }
  }

  async deleteAlias(idRaw: unknown): Promise<{
    ok: true;
    deleted: boolean;
    item: unknown;
  }> {
    const id = parsePositiveInt(idRaw);
    if (!id) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "id" });
    }

    const current = await this.adminAliasesRepository.getById(id);
    if (!current) {
      throw new PublicHttpException(404, { error: "alias_not_found", id });
    }

    const deleted = await this.adminAliasesRepository.deleteById(id);

    return { ok: true, deleted: Boolean(deleted), item: current };
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

  private isDuplicateEntry(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ER_DUP_ENTRY"
    );
  }
}

@Injectable()
export class AdminHandlesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly adminHandlesRepository: AdminHandlesRepository,
    private readonly banPolicyService: BanPolicyService,
  ) {}

  async listHandles(query: AdminHandlesListQueryDto): Promise<{
    items: Awaited<ReturnType<AdminHandlesRepository["listAll"]>>;
    pagination: { total: number; limit: number; offset: number };
  }> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const [items, total] = await Promise.all([
      this.adminHandlesRepository.listAll({
        limit,
        offset,
        active: query.active,
        handle: query.handle,
        address: query.address,
      }),
      this.adminHandlesRepository.countAll({
        active: query.active,
        handle: query.handle,
        address: query.address,
      }),
    ]);

    return {
      items,
      pagination: { total, limit, offset },
    };
  }

  async getHandleById(idRaw: unknown): Promise<{ item: unknown }> {
    const id = parsePositiveInt(idRaw);
    if (!id) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "id" });
    }

    const row = await this.adminHandlesRepository.getById(id);
    if (!row) {
      throw new PublicHttpException(404, { error: "handle_not_found", id });
    }

    return { item: row };
  }

  async createHandle(dto: AdminCreateHandleDto): Promise<{
    ok: true;
    created: true;
    item: unknown;
  }> {
    const handle = normalizeLowerTrim(dto.handle);
    if (!handle || !isValidLocalPart(handle)) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "handle" });
    }

    const address = parseMailbox(dto.address);
    if (!address) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "address" });
    }

    const active = dto.active === undefined ? 1 : dto.active;
    await this.ensureHandleBans(handle, address.email);

    try {
      const row = await this.database.withTransaction(async (connection) => {
        const existing = await this.adminHandlesRepository.getByHandle(handle, connection, {
          forUpdate: true,
        });
        if (existing) {
          throw new PublicHttpException(409, { error: "handle_taken", handle });
        }

        const created = await this.adminHandlesRepository.createHandle(
          { handle, address: address.email, active },
          connection,
        );

        return created.insertId
          ? this.adminHandlesRepository.getById(created.insertId, connection)
          : null;
      });

      return { ok: true, created: true, item: row };
    } catch (error) {
      if (this.isDuplicateEntry(error)) {
        throw new PublicHttpException(409, { error: "handle_taken", handle });
      }
      throw error;
    }
  }

  async updateHandle(
    idRaw: unknown,
    dto: AdminUpdateHandleDto,
  ): Promise<{ ok: true; updated: true; item: unknown }> {
    const id = parsePositiveInt(idRaw);
    if (!id) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "id" });
    }

    try {
      const row = await this.database.withTransaction(async (connection) => {
        const current = await this.adminHandlesRepository.getById(id, connection, {
          forUpdate: true,
        });
        if (!current) {
          throw new PublicHttpException(404, { error: "handle_not_found", id });
        }

        const patch: { handle?: string; address?: string; active?: number } = {};
        let nextHandle = String(current.handle || "").trim().toLowerCase();
        let nextAddress = String(current.address || "").trim().toLowerCase();
        let handleChanged = false;
        let addressChanged = false;

        if (dto.handle !== undefined) {
          const parsed = normalizeLowerTrim(dto.handle);
          if (!parsed || !isValidLocalPart(parsed)) {
            throw new PublicHttpException(400, {
              error: "invalid_params",
              field: "handle",
            });
          }

          const conflict = await this.adminHandlesRepository.getByHandle(parsed, connection, {
            forUpdate: true,
          });
          if (conflict && Number(conflict.id) !== id) {
            throw new PublicHttpException(409, { error: "handle_taken", handle: parsed });
          }

          patch.handle = parsed;
          nextHandle = parsed;
          handleChanged = true;
        }

        if (dto.address !== undefined) {
          const parsed = parseMailbox(dto.address);
          if (!parsed) {
            throw new PublicHttpException(400, {
              error: "invalid_params",
              field: "address",
            });
          }

          patch.address = parsed.email;
          nextAddress = parsed.email;
          addressChanged = true;
        }

        if (dto.active !== undefined) {
          patch.active = dto.active;
        }

        const nextActive =
          patch.active === 0 || patch.active === 1 ? patch.active : Number(current.active || 0);

        if (handleChanged || addressChanged || nextActive === 1) {
          await this.ensureHandleBans(nextHandle, nextAddress);
        }

        if (Object.keys(patch).length === 0) {
          throw new PublicHttpException(400, {
            error: "invalid_params",
            reason: "empty_patch",
          });
        }

        await this.adminHandlesRepository.updateById(id, patch, connection);
        return this.adminHandlesRepository.getById(id, connection);
      });

      return { ok: true, updated: true, item: row };
    } catch (error) {
      if (this.isDuplicateEntry(error)) {
        throw new PublicHttpException(409, { error: "handle_taken" });
      }
      throw error;
    }
  }

  async deleteHandle(idRaw: unknown): Promise<{
    ok: true;
    deleted: boolean;
    item: unknown;
  }> {
    const id = parsePositiveInt(idRaw);
    if (!id) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "id" });
    }

    const current = await this.adminHandlesRepository.getById(id);
    if (!current) {
      throw new PublicHttpException(404, { error: "handle_not_found", id });
    }

    const deleted = await this.adminHandlesRepository.deleteById(id);

    return { ok: true, deleted: Boolean(deleted), item: current };
  }

  private async ensureHandleBans(handle: string, address: string): Promise<void> {
    const banName = await this.banPolicyService.findActiveNameBan(handle);
    if (banName) {
      throw new PublicHttpException(403, { error: "banned", ban: banName });
    }

    const banAddress = await this.banPolicyService.findActiveEmailOrDomainBan(address);
    if (banAddress) {
      throw new PublicHttpException(403, { error: "banned", ban: banAddress });
    }
  }

  private isDuplicateEntry(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ER_DUP_ENTRY"
    );
  }
}
