import { Injectable } from "@nestjs/common";

import { PublicHttpException } from "../../shared/errors/public-http.exception.js";
import {
  normalizeEmailStrict,
  normalizeUsername,
} from "../../shared/utils/auth-identifiers.js";
import type { ResolvedAuthContext } from "../auth/services/auth-session-context.service.js";
import { PasswordService } from "../auth/services/password.service.js";
import { AdminNotificationService } from "./admin-notification.service.js";
import { AdminUsersRepository } from "./admin-users.repository.js";
import type {
  AdminCreateUserDto,
  AdminUpdateOwnPasswordDto,
  AdminUpdateUserDto,
  AdminUsersListQueryDto,
} from "./admin.dto.js";
import { parsePositiveInt, toAdminPublicUser } from "./admin.utils.js";

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly adminUsersRepository: AdminUsersRepository,
    private readonly passwordService: PasswordService,
    private readonly adminNotificationService: AdminNotificationService,
  ) {}

  async listUsers(query: AdminUsersListQueryDto): Promise<{
    items: Array<ReturnType<typeof toAdminPublicUser>>;
    pagination: { total: number; limit: number; offset: number };
  }> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const [rows, total] = await Promise.all([
      this.adminUsersRepository.listUsers({
        limit,
        offset,
        active: query.active,
        email: query.email,
        isAdmin: query.is_admin,
      }),
      this.adminUsersRepository.countUsers({
        active: query.active,
        email: query.email,
        isAdmin: query.is_admin,
      }),
    ]);

    return {
      items: rows.map((row) => toAdminPublicUser(row)),
      pagination: { total, limit, offset },
    };
  }

  async getUserById(idRaw: unknown): Promise<{ item: ReturnType<typeof toAdminPublicUser> }> {
    const id = parsePositiveInt(idRaw);
    if (!id) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "id" });
    }

    const row = await this.adminUsersRepository.getUserById(id);
    if (!row) {
      throw new PublicHttpException(404, { error: "admin_user_not_found", id });
    }

    return { item: toAdminPublicUser(row) };
  }

  async createUser(
    dto: AdminCreateUserDto,
    authContext: ResolvedAuthContext,
    requestMeta: { ip: string; userAgent: string },
  ): Promise<{ ok: true; created: true; item: ReturnType<typeof toAdminPublicUser> }> {
    const username = normalizeUsername(dto.username);
    if (!username) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "username" });
    }

    const email = normalizeEmailStrict(dto.email);
    if (!email) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "email" });
    }

    try {
      this.passwordService.assertPlainPassword(dto.password);
    } catch {
      throw new PublicHttpException(400, {
        error: "invalid_params",
        field: "password",
      });
    }

    const [existingByEmail, existingByUsername] = await Promise.all([
      this.adminUsersRepository.getUserByEmail(email),
      this.adminUsersRepository.getUserByUsername(username),
    ]);
    if (existingByEmail) {
      throw new PublicHttpException(409, {
        error: "admin_user_taken",
        field: "email",
        email,
      });
    }
    if (existingByUsername) {
      throw new PublicHttpException(409, {
        error: "admin_user_taken",
        field: "username",
        username,
      });
    }

    const passwordHash = await this.passwordService.hashPassword(dto.password);
    const isActive = dto.is_active === undefined ? 1 : dto.is_active;
    const isAdmin = dto.is_admin === undefined ? 1 : dto.is_admin;

    try {
      const created = await this.adminUsersRepository.createUser({
        username,
        email,
        passwordHash,
        isActive,
        isAdmin,
        emailVerifiedAt: new Date(),
      });

      const row = created.insertId
        ? await this.adminUsersRepository.getUserById(created.insertId)
        : null;

      if (row && Number(row.is_admin || 0) === 1) {
        this.adminNotificationService.notifyAffectedAdmins({
          recipientEmails: [email],
          targetEmail: email,
          actorEmail: String(authContext.email || "").trim().toLowerCase(),
          action: "admin_user_created",
          changes: ["email", "password", "is_active", "is_admin"],
          requestIpText: requestMeta.ip,
          userAgent: requestMeta.userAgent,
          occurredAt: new Date(),
        });
      }

      return { ok: true, created: true, item: toAdminPublicUser(row) };
    } catch (error) {
      if (this.isDuplicateEntry(error)) {
        throw new PublicHttpException(409, { error: "admin_user_taken" });
      }
      throw error;
    }
  }

  async updateUser(
    idRaw: unknown,
    dto: AdminUpdateUserDto,
    authContext: ResolvedAuthContext,
    requestMeta: { ip: string; userAgent: string },
  ): Promise<{
    ok: true;
    updated: true;
    sessions_revoked: number;
    item: ReturnType<typeof toAdminPublicUser>;
    shouldClearAuthCookies: boolean;
  }> {
    const id = parsePositiveInt(idRaw);
    if (!id) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "id" });
    }

    const actorUserId = Number(authContext.user_id || 0);

    try {
      const result = await this.adminUsersRepository.withTransaction(async (connection) => {
        const current = await this.adminUsersRepository.getUserById(id, connection, {
          forUpdate: true,
        });
        if (!current) {
          throw new PublicHttpException(404, { error: "admin_user_not_found", id });
        }

        const patch: {
          email?: string;
          username?: string;
          passwordHash?: string;
          isActive?: number;
          isAdmin?: number;
        } = {};
        const changes: string[] = [];
        const currentIsAdmin = Number(current.is_admin || 0) === 1;

        if (dto.email !== undefined) {
          const email = normalizeEmailStrict(dto.email);
          if (!email) {
            throw new PublicHttpException(400, { error: "invalid_params", field: "email" });
          }

          const conflict = await this.adminUsersRepository.getUserByEmail(
            email,
            connection,
            { forUpdate: true },
          );
          if (conflict && Number(conflict.id) !== id) {
            throw new PublicHttpException(409, { error: "admin_user_taken", email });
          }

          if (email !== String(current.email || "").trim().toLowerCase()) {
            patch.email = email;
            changes.push("email");
          }
        }

        if (dto.is_active !== undefined) {
          const currentActive = Number(current.is_active || 0);
          if (dto.is_active !== currentActive) {
            if (currentActive === 1 && currentIsAdmin && dto.is_active === 0) {
              const activeAdminIds = await this.adminUsersRepository.listActiveAdminIdsForUpdate(
                connection,
              );
              if (activeAdminIds.length <= 1) {
                throw new PublicHttpException(409, {
                  error: "cannot_disable_last_admin",
                });
              }
            }

            patch.isActive = dto.is_active;
            changes.push("is_active");
          }
        }

        if (dto.username !== undefined) {
          const username = normalizeUsername(dto.username);
          if (!username) {
            throw new PublicHttpException(400, {
              error: "invalid_params",
              field: "username",
            });
          }

          const conflict = await this.adminUsersRepository.getUserByUsername(
            username,
            connection,
            { forUpdate: true },
          );
          if (conflict && Number(conflict.id) !== id) {
            throw new PublicHttpException(409, {
              error: "admin_user_taken",
              username,
            });
          }

          if (username !== String(current.username || "").trim().toLowerCase()) {
            patch.username = username;
            changes.push("username");
          }
        }

        if (dto.is_admin !== undefined) {
          const currentAdmin = Number(current.is_admin || 0);
          if (dto.is_admin !== currentAdmin) {
            const nextIsActive =
              patch.isActive === undefined ? Number(current.is_active || 0) : patch.isActive;
            if (currentIsAdmin && nextIsActive === 1 && dto.is_admin === 0) {
              const activeAdminIds = await this.adminUsersRepository.listActiveAdminIdsForUpdate(
                connection,
              );
              if (activeAdminIds.length <= 1) {
                throw new PublicHttpException(409, {
                  error: "cannot_demote_last_admin",
                });
              }
            }

            patch.isAdmin = dto.is_admin;
            changes.push("is_admin");
          }
        }

        if (dto.password !== undefined) {
          if (actorUserId === id) {
            throw new PublicHttpException(400, {
              error: "invalid_params",
              field: "password",
              reason: "use_self_password_route",
            });
          }

          try {
            this.passwordService.assertPlainPassword(dto.password);
          } catch {
            throw new PublicHttpException(400, {
              error: "invalid_params",
              field: "password",
            });
          }

          patch.passwordHash = await this.passwordService.hashPassword(dto.password);
          changes.push("password");
        }

        if (Object.keys(patch).length === 0) {
          throw new PublicHttpException(400, {
            error: "invalid_params",
            reason: "empty_patch",
          });
        }

        await this.adminUsersRepository.updateUserById(id, patch, connection);

        let revokedSessions = 0;
        if (
          patch.passwordHash !== undefined ||
          patch.isActive === 0 ||
          patch.isAdmin !== undefined
        ) {
          revokedSessions = await this.adminUsersRepository.revokeSessionsByUserId(
            id,
            {},
            connection,
          );
        }

        const row = await this.adminUsersRepository.getUserById(id, connection);
        return {
          current,
          row,
          revokedSessions,
          changes,
        };
      });

      const currentIsAdmin = Number(result.current?.is_admin || 0) === 1;
      const newIsAdmin = Number(result.row?.is_admin || 0) === 1;
      const oldEmail = String(result.current?.email || "").trim().toLowerCase();
      const newEmail = String(result.row?.email || "").trim().toLowerCase();

      if (currentIsAdmin || newIsAdmin || result.changes.includes("is_admin")) {
        this.adminNotificationService.notifyAffectedAdmins({
          recipientEmails: [oldEmail, newEmail],
          targetEmail: newEmail || oldEmail,
          actorEmail: String(authContext.email || "").trim().toLowerCase(),
          action: "admin_user_updated",
          changes: result.changes,
          requestIpText: requestMeta.ip,
          userAgent: requestMeta.userAgent,
          occurredAt: new Date(),
        });
      }

      return {
        ok: true,
        updated: true,
        sessions_revoked: result.revokedSessions,
        item: toAdminPublicUser(result.row),
        shouldClearAuthCookies:
          actorUserId === id &&
          (Number(result.row?.is_active || 0) !== 1 || Number(result.row?.is_admin || 0) !== 1),
      };
    } catch (error) {
      if (this.isDuplicateEntry(error)) {
        throw new PublicHttpException(409, { error: "admin_user_taken" });
      }
      throw error;
    }
  }

  async deleteUser(
    idRaw: unknown,
    authContext: ResolvedAuthContext,
    requestMeta: { ip: string; userAgent: string },
  ): Promise<{
    ok: true;
    deleted: boolean;
    sessions_revoked: number;
    item: ReturnType<typeof toAdminPublicUser>;
    shouldClearAuthCookies: boolean;
  }> {
    const id = parsePositiveInt(idRaw);
    if (!id) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "id" });
    }

    const actorUserId = Number(authContext.user_id || 0);
    const result = await this.adminUsersRepository.withTransaction(async (connection) => {
      const current = await this.adminUsersRepository.getUserById(id, connection, {
        forUpdate: true,
      });
      if (!current) {
        throw new PublicHttpException(404, { error: "admin_user_not_found", id });
      }

      if (Number(current.is_active || 0) === 1 && Number(current.is_admin || 0) === 1) {
        const activeAdminIds = await this.adminUsersRepository.listActiveAdminIdsForUpdate(
          connection,
        );
        if (activeAdminIds.length <= 1) {
          throw new PublicHttpException(409, { error: "cannot_disable_last_admin" });
        }
      }

      const revokedSessions = await this.adminUsersRepository.revokeSessionsByUserId(
        id,
        {},
        connection,
      );
      const deleted = await this.adminUsersRepository.deleteUserById(id, connection);

      return { current, deleted, revokedSessions };
    });

    if (Number(result.current?.is_admin || 0) === 1) {
      const targetEmail = String(result.current?.email || "").trim().toLowerCase();
      this.adminNotificationService.notifyAffectedAdmins({
        recipientEmails: [targetEmail],
        targetEmail,
        actorEmail: String(authContext.email || "").trim().toLowerCase(),
        action: "admin_user_deleted",
        changes: ["is_active"],
        requestIpText: requestMeta.ip,
        userAgent: requestMeta.userAgent,
        occurredAt: new Date(),
      });
    }

    return {
      ok: true,
      deleted: Boolean(result.deleted),
      sessions_revoked: result.revokedSessions,
      item: toAdminPublicUser(result.current),
      shouldClearAuthCookies: actorUserId === id,
    };
  }

  async updateOwnPassword(
    dto: AdminUpdateOwnPasswordDto,
    authContext: ResolvedAuthContext,
    requestMeta: { ip: string; userAgent: string },
  ): Promise<{
    ok: true;
    updated: true;
    reauth_required: true;
    sessions_revoked: number;
    shouldClearAuthCookies: true;
  }> {
    const actorUserId = Number(authContext.user_id || 0);
    if (!Number.isInteger(actorUserId) || actorUserId <= 0) {
      throw new PublicHttpException(401, { error: "invalid_or_expired_session" });
    }

    if (dto.new_password === dto.current_password) {
      throw new PublicHttpException(400, {
        error: "invalid_params",
        field: "new_password",
        reason: "same_as_current",
      });
    }

    const result = await this.adminUsersRepository.withTransaction(async (connection) => {
      const currentUser = await this.adminUsersRepository.getUserById(actorUserId, connection, {
        forUpdate: true,
      });
      if (!currentUser || Number(currentUser.is_active || 0) !== 1) {
        throw new PublicHttpException(401, { error: "invalid_or_expired_session" });
      }

      const isValid = await this.passwordService.verifyPassword(
        String(currentUser.password_hash || ""),
        dto.current_password,
      );
      if (!isValid) {
        throw new PublicHttpException(401, {
          error: "invalid_credentials",
          field: "current_password",
        });
      }

      const passwordHash = await this.passwordService.hashPassword(dto.new_password);
      await this.adminUsersRepository.updateUserById(
        actorUserId,
        { passwordHash },
        connection,
      );
      const revokedSessions = await this.adminUsersRepository.revokeSessionsByUserId(
        actorUserId,
        {},
        connection,
      );

      return {
        currentUser,
        revokedSessions,
      };
    });

    const targetEmail = String(result.currentUser.email || "").trim().toLowerCase();
    this.adminNotificationService.notifyAffectedAdmins({
      recipientEmails: [targetEmail],
      targetEmail,
      actorEmail: String(authContext.email || "").trim().toLowerCase(),
      action: "admin_password_changed",
      changes: ["password"],
      requestIpText: requestMeta.ip,
      userAgent: requestMeta.userAgent,
      occurredAt: new Date(),
    });

    return {
      ok: true,
      updated: true,
      reauth_required: true,
      sessions_revoked: result.revokedSessions,
      shouldClearAuthCookies: true,
    };
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
