import { Injectable } from "@nestjs/common";
import type { PoolConnection } from "mariadb";

import { DatabaseService } from "../../../shared/database/database.service.js";
import {
  normalizeEmailStrict,
  normalizeUsername,
} from "../../../shared/utils/auth-identifiers.js";
import {
  CountRow,
  InsertResult,
  runQuery,
  withTxRetry,
} from "../utils/admin-database.utils.js";
import { buildContainsLikePattern } from "../utils/admin.utils.js";

const USER_SELECT_COLUMNS = `
  id,
  username,
  email,
  password_hash,
  email_verified_at,
  is_active,
  is_admin,
  password_changed_at,
  created_at,
  updated_at,
  last_login_at
`;

const SESSION_STATUS_ACTIVE = "active";
const SESSION_STATUS_ROTATED = "rotated";
const SESSION_STATUS_REVOKED = "revoked";

export interface AdminUserInternalRow {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  email_verified_at: Date | string | null;
  is_active: number;
  is_admin: number;
  password_changed_at: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  last_login_at: Date | string | null;
}

function assertUserId(value: unknown): number {
  const userId = Number(value);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("invalid_user_id");
  }
  return userId;
}

function assertEmail(value: unknown): string {
  const email = normalizeEmailStrict(value);
  if (!email) throw new Error("invalid_email");
  return email;
}

function assertUsername(value: unknown): string {
  const username = normalizeUsername(value);
  if (!username) throw new Error("invalid_username");
  return username;
}

function assertPasswordHash(value: unknown): string {
  const passwordHash = typeof value === "string" ? value.trim() : "";
  if (!passwordHash || passwordHash.length > 255) {
    throw new Error("invalid_password_hash");
  }
  return passwordHash;
}

function normalizeOptionalDatetime(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

@Injectable()
export class AdminUsersRepository {
  constructor(private readonly database: DatabaseService) {}

  async withTransaction<T>(work: (connection: PoolConnection) => Promise<T>): Promise<T> {
    return withTxRetry(this.database, work);
  }

  async getUserById(
    id: number,
    connection?: PoolConnection,
    options: { forUpdate?: boolean } = {},
  ): Promise<AdminUserInternalRow | null> {
    const executor = connection ?? this.database;
    const lockClause = options.forUpdate ? " FOR UPDATE" : "";
    const rows = await runQuery<AdminUserInternalRow[]>(
      executor,
      `SELECT ${USER_SELECT_COLUMNS}
       FROM users
       WHERE id = ?
       LIMIT 1${lockClause}`,
      [assertUserId(id)],
    );

    return rows[0] ?? null;
  }

  async getUserByEmail(
    email: string,
    connection?: PoolConnection,
    options: { forUpdate?: boolean } = {},
  ): Promise<AdminUserInternalRow | null> {
    const executor = connection ?? this.database;
    const lockClause = options.forUpdate ? " FOR UPDATE" : "";
    const rows = await runQuery<AdminUserInternalRow[]>(
      executor,
      `SELECT ${USER_SELECT_COLUMNS}
       FROM users
       WHERE email = ?
       LIMIT 1${lockClause}`,
      [assertEmail(email)],
    );

    return rows[0] ?? null;
  }

  async getUserByUsername(
    username: string,
    connection?: PoolConnection,
    options: { forUpdate?: boolean } = {},
  ): Promise<AdminUserInternalRow | null> {
    const executor = connection ?? this.database;
    const lockClause = options.forUpdate ? " FOR UPDATE" : "";
    const rows = await runQuery<AdminUserInternalRow[]>(
      executor,
      `SELECT ${USER_SELECT_COLUMNS}
       FROM users
       WHERE username = ?
       LIMIT 1${lockClause}`,
      [assertUsername(username)],
    );

    return rows[0] ?? null;
  }

  async listUsers(input: {
    limit: number;
    offset: number;
    active?: number | undefined;
    email?: string | undefined;
    isAdmin?: number | undefined;
  }): Promise<AdminUserInternalRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (input.active === 0 || input.active === 1) {
      where.push("is_active = ?");
      params.push(input.active);
    }
    if (input.isAdmin === 0 || input.isAdmin === 1) {
      where.push("is_admin = ?");
      params.push(input.isAdmin);
    }

    const emailPattern = buildContainsLikePattern(input.email);
    if (emailPattern) {
      where.push("email LIKE ? ESCAPE '\\\\'");
      params.push(emailPattern);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    return this.database.query<AdminUserInternalRow[]>(
      `SELECT ${USER_SELECT_COLUMNS}
       FROM users
       ${whereSql}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...params, input.limit, input.offset],
    );
  }

  async countUsers(input: {
    active?: number | undefined;
    email?: string | undefined;
    isAdmin?: number | undefined;
  }): Promise<number> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (input.active === 0 || input.active === 1) {
      where.push("is_active = ?");
      params.push(input.active);
    }
    if (input.isAdmin === 0 || input.isAdmin === 1) {
      where.push("is_admin = ?");
      params.push(input.isAdmin);
    }

    const emailPattern = buildContainsLikePattern(input.email);
    if (emailPattern) {
      where.push("email LIKE ? ESCAPE '\\\\'");
      params.push(emailPattern);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await this.database.query<CountRow[]>(
      `SELECT COUNT(*) AS total
       FROM users
       ${whereSql}`,
      params,
    );

    return Number(rows[0]?.total ?? 0);
  }

  async listActiveAdminIdsForUpdate(connection: PoolConnection): Promise<number[]> {
    const rows = await connection.query<Array<{ id: number }>>(
      `SELECT id
       FROM users
       WHERE is_active = 1
         AND is_admin = 1
       ORDER BY id ASC
       FOR UPDATE`,
    );

    return rows
      .map((row) => Number(row.id))
      .filter((value) => Number.isInteger(value) && value > 0);
  }

  async createUser(
    payload: {
      email: string;
      username: string;
      passwordHash: string;
      isActive: number;
      isAdmin: number;
      emailVerifiedAt: Date | string | null;
    },
    connection?: PoolConnection,
  ): Promise<{ ok: boolean; insertId: number | null }> {
    const executor = connection ?? this.database;
    const result = await runQuery<InsertResult>(
      executor,
      `INSERT INTO users (
        username,
        email,
        password_hash,
        email_verified_at,
        is_active,
        is_admin,
        password_changed_at,
        created_at,
        updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, NOW(6), NOW(6), NOW(6)
      )`,
      [
        assertUsername(payload.username),
        assertEmail(payload.email),
        assertPasswordHash(payload.passwordHash),
        payload.emailVerifiedAt ? new Date(String(payload.emailVerifiedAt)) : null,
        payload.isActive ? 1 : 0,
        payload.isAdmin ? 1 : 0,
      ],
    );

    return {
      ok: Boolean(result?.affectedRows === 1),
      insertId: result?.insertId != null ? Number(result.insertId) : null,
    };
  }

  async updateUserById(
    id: number,
    patch: {
      email?: string;
      username?: string;
      passwordHash?: string;
      isActive?: number;
      isAdmin?: number;
      emailVerifiedAt?: Date | string | null;
      passwordChangedAt?: Date | string | null;
    },
    connection?: PoolConnection,
  ): Promise<boolean> {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (patch.username !== undefined) {
      updates.push("username = ?");
      params.push(assertUsername(patch.username));
    }
    if (patch.email !== undefined) {
      updates.push("email = ?");
      params.push(assertEmail(patch.email));
    }
    if (patch.passwordHash !== undefined) {
      updates.push("password_hash = ?");
      params.push(assertPasswordHash(patch.passwordHash));
      updates.push("password_changed_at = NOW(6)");
    }
    if (patch.emailVerifiedAt !== undefined) {
      updates.push("email_verified_at = ?");
      params.push(normalizeOptionalDatetime(patch.emailVerifiedAt));
    }
    if (patch.passwordChangedAt !== undefined) {
      updates.push("password_changed_at = ?");
      params.push(normalizeOptionalDatetime(patch.passwordChangedAt));
    }
    if (patch.isActive === 0 || patch.isActive === 1) {
      updates.push("is_active = ?");
      params.push(patch.isActive);
    }
    if (patch.isAdmin === 0 || patch.isAdmin === 1) {
      updates.push("is_admin = ?");
      params.push(patch.isAdmin);
    }
    if (updates.length === 0) return false;

    updates.push("updated_at = NOW(6)");

    const executor = connection ?? this.database;
    const result = await runQuery<InsertResult>(
      executor,
      `UPDATE users
       SET ${updates.join(", ")}
       WHERE id = ?
       LIMIT 1`,
      [...params, assertUserId(id)],
    );

    return Boolean(result?.affectedRows === 1);
  }

  async deleteUserById(id: number, connection?: PoolConnection): Promise<boolean> {
    const executor = connection ?? this.database;
    await runQuery<InsertResult>(
      executor,
      `DELETE FROM password_reset_tokens
       WHERE user_id = ?`,
      [assertUserId(id)],
    );

    await runQuery<InsertResult>(
      executor,
      `DELETE FROM auth_sessions
       WHERE user_id = ?`,
      [assertUserId(id)],
    );

    const result = await runQuery<InsertResult>(
      executor,
      `DELETE FROM users
       WHERE id = ?
       LIMIT 1`,
      [assertUserId(id)],
    );

    return Boolean(result?.affectedRows === 1);
  }

  async revokeSessionsByUserId(
    userId: number,
    options: { exceptSessionFamilyId?: string } = {},
    connection?: PoolConnection,
  ): Promise<number> {
    const executor = connection ?? this.database;
    const params: unknown[] = [SESSION_STATUS_REVOKED, assertUserId(userId)];
    let exceptSql = "";

    if (options.exceptSessionFamilyId) {
      exceptSql = "AND session_family_id <> ?";
      params.push(String(options.exceptSessionFamilyId || "").trim());
    }

    const result = await runQuery<InsertResult>(
      executor,
      `UPDATE auth_sessions
       SET status = ?,
           revoked_at = COALESCE(revoked_at, NOW(6))
       WHERE user_id = ?
         ${exceptSql}
         AND status IN (?, ?)`,
      [...params, SESSION_STATUS_ACTIVE, SESSION_STATUS_ROTATED],
    );

    return Number(result?.affectedRows ?? 0);
  }
}
