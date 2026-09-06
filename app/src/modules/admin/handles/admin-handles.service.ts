import { Injectable } from "@nestjs/common";
import type { PoolConnection } from "mariadb";

import { isDuplicateEntry } from "../../../shared/database/database.utils.js";
import { PublicHttpException } from "../../../shared/errors/public-http.exception.js";
import { DatabaseService } from "../../../shared/database/database.service.js";
import { withLocalPartRoutingLock } from "../../../shared/database/local-part-routing-lock.js";
import {
  isValidLocalPart,
  parseMailbox,
  normalizeLowerTrim,
} from "../../../shared/validation/mailbox.js";
import { BanPolicyService } from "../../bans/ban-policy.service.js";
import { AdminAliasesRepository } from "../aliases/admin-aliases.repository.js";
import { AdminCreationNotificationService } from "../utils/admin-creation-notification.service.js";
import { AdminHandlesRepository } from "./admin-handles.repository.js";
import type { AdminHandleRow } from "./admin-handles.repository.js";
import type {
  AdminCreateHandleDto,
  AdminHandlesListQueryDto,
  AdminUpdateHandleDto,
} from "../dto/admin.dto.js";

@Injectable()
export class AdminHandlesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly adminHandlesRepository: AdminHandlesRepository,
    private readonly adminAliasesRepository: AdminAliasesRepository,
    private readonly banPolicyService: BanPolicyService,
    private readonly creationNotificationService: AdminCreationNotificationService,
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

  async getHandleById(id: number): Promise<{ item: AdminHandleRow }> {
    const row = await this.adminHandlesRepository.getById(id);
    if (!row) {
      throw new PublicHttpException(404, { error: "handle_not_found", id });
    }

    return { item: row };
  }

  async createHandle(dto: AdminCreateHandleDto): Promise<{
    ok: true;
    created: true;
    item: AdminHandleRow | null;
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
        return withLocalPartRoutingLock(connection, handle, async () => {
          const existing = await this.adminHandlesRepository.getByHandle(handle, connection, {
            forUpdate: true,
          });
          if (existing) {
            throw new PublicHttpException(409, { error: "handle_taken", handle });
          }

          await this.ensureNoActiveAliasLocalPart(handle, connection);

          const created = await this.adminHandlesRepository.createHandle(
            { handle, address: address.email, active },
            connection,
          );

          return created.insertId
            ? this.adminHandlesRepository.getById(created.insertId, connection)
            : null;
        });
      });

      this.creationNotificationService.notifyHandleCreated({
        handle,
        addressEmail: address.email,
      });

      return { ok: true, created: true, item: row };
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw new PublicHttpException(409, { error: "handle_taken", handle });
      }
      throw error;
    }
  }

  async updateHandle(
    id: number,
    dto: AdminUpdateHandleDto,
  ): Promise<{ ok: true; updated: true; item: AdminHandleRow | null }> {
    let requestedHandle: string | undefined;
    if (dto.handle !== undefined) {
      const parsed = normalizeLowerTrim(dto.handle);
      if (!parsed || !isValidLocalPart(parsed)) {
        throw new PublicHttpException(400, {
          error: "invalid_params",
          field: "handle",
        });
      }
      requestedHandle = parsed;
    }

    let requestedAddress: string | undefined;
    if (dto.address !== undefined) {
      const parsed = parseMailbox(dto.address);
      if (!parsed) {
        throw new PublicHttpException(400, {
          error: "invalid_params",
          field: "address",
        });
      }
      requestedAddress = parsed.email;
    }

    try {
      const row = await this.database.withTransaction(async (connection) => {
        const snapshot = await this.adminHandlesRepository.getById(id, connection);
        if (!snapshot) {
          throw new PublicHttpException(404, { error: "handle_not_found", id });
        }

        const snapshotHandle = String(snapshot.handle || "").trim().toLowerCase();
        const snapshotActive =
          dto.active === 0 || dto.active === 1 ? dto.active : Number(snapshot.active || 0);
        const lockHandle = requestedHandle ?? snapshotHandle;
        let hasRoutingLock = false;

        const update = async () => {
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

          if (requestedHandle !== undefined) {
            const conflict = await this.adminHandlesRepository.getByHandle(
              requestedHandle,
              connection,
              { forUpdate: true },
            );
            if (conflict && Number(conflict.id) !== id) {
              throw new PublicHttpException(409, {
                error: "handle_taken",
                handle: requestedHandle,
              });
            }

            patch.handle = requestedHandle;
            nextHandle = requestedHandle;
            handleChanged = true;
          }

          if (requestedAddress !== undefined) {
            patch.address = requestedAddress;
            nextAddress = requestedAddress;
            addressChanged = true;
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

          if (nextActive === 1 && nextHandle !== lockHandle) {
            throw new PublicHttpException(409, {
              ok: false,
              error: "alias_state_changed",
              reason: "handle_local_part_changed",
            });
          }

          if (nextActive === 1 && !hasRoutingLock) {
            throw new PublicHttpException(409, {
              ok: false,
              error: "alias_state_changed",
              reason: "handle_active_state_changed",
            });
          }

          if (nextActive === 1) {
            await this.ensureNoActiveAliasLocalPart(nextHandle, connection);
          }

          if (handleChanged || addressChanged || nextActive === 1) {
            await this.ensureHandleBans(nextHandle, nextAddress);
          }

          await this.adminHandlesRepository.updateById(id, patch, connection);
          return this.adminHandlesRepository.getById(id, connection);
        };

        return snapshotActive === 1
          ? withLocalPartRoutingLock(connection, lockHandle, async () => {
              hasRoutingLock = true;
              return update();
            })
          : update();
      });

      return { ok: true, updated: true, item: row };
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw new PublicHttpException(409, { error: "handle_taken" });
      }
      throw error;
    }
  }

  async deleteHandle(id: number): Promise<{
    ok: true;
    deleted: boolean;
    item: AdminHandleRow;
  }> {
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

  private async ensureNoActiveAliasLocalPart(
    handle: string,
    connection?: PoolConnection,
  ): Promise<void> {
    const aliasExists = await this.adminAliasesRepository.existsActiveAliasByLocalPart(
      handle,
      connection,
      { forUpdate: true },
    );
    if (aliasExists) {
      throw new PublicHttpException(409, { error: "alias_taken", handle });
    }
  }

}
