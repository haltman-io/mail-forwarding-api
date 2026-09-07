import { Injectable } from "@nestjs/common";
import type { PoolConnection } from "mariadb";

import { DatabaseService } from "../../../shared/database/database.service.js";
import type { CountRow } from "../utils/admin-database.utils.js";
import { InsertResult, runQuery } from "../utils/admin-database.utils.js";
import { buildContainsLikePattern } from "../utils/admin.utils.js";

export interface AdminSmtpUserRow {
  id: number;
  username: string;
  password: string;
  active: number;
  created_at: Date | string | null;
}

export interface AdminSmtpCredentialRow {
  id: number;
  username: string;
  active: number;
  created_at: Date | string | null;
  allowed_senders: string[];
}

export interface SmtpInviteTokenRow {
  id: number;
  token_hash: Buffer;
  created_by: string;
  allowed_sender_constraint: string | null;
  is_used: number;
  used_at: Date | string | null;
  created_username: string | null;
  expires_at: Date | string;
  created_at: Date | string;
}

interface SenderRow {
  login: string;
  sender: string;
}

interface SmtpCredentialFilters {
  limit: number;
  offset: number;
  active?: number | undefined;
  username?: string | undefined;
  sender?: string | undefined;
}

const SMTP_USER_COLUMNS = "id, username, password, active, created_at";
const SMTP_INVITE_COLUMNS =
  "id, token_hash, created_by, allowed_sender_constraint, is_used, used_at, created_username, expires_at, created_at";

@Injectable()
export class AdminSmtpCredentialsRepository {
  constructor(private readonly database: DatabaseService) {}

  async getUserByUsername(
    username: string,
    connection?: PoolConnection,
    options: { forUpdate?: boolean } = {},
  ): Promise<AdminSmtpUserRow | null> {
    const executor = connection ?? this.database;
    const lockClause = options.forUpdate ? " FOR UPDATE" : "";
    const rows = await runQuery<AdminSmtpUserRow[]>(
      executor,
      `SELECT ${SMTP_USER_COLUMNS}
       FROM smtp_users
       WHERE username = ?
       LIMIT 1${lockClause}`,
      [username],
    );

    return rows[0] ?? null;
  }

  async listCredentials(filters: SmtpCredentialFilters): Promise<AdminSmtpCredentialRow[]> {
    const where = this.buildCredentialsWhere(filters);
    const rows = await this.database.query<AdminSmtpUserRow[]>(
      `SELECT ${SMTP_USER_COLUMNS}
       FROM smtp_users
       ${where.whereSql}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...where.params, filters.limit, filters.offset],
    );
    const allowedSenders = await this.listActiveSendersForLogins(
      rows.map((row) => row.username),
    );

    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      active: Number(row.active || 0),
      created_at: row.created_at,
      allowed_senders: allowedSenders.get(row.username) ?? [],
    }));
  }

  async countCredentials(filters: Omit<SmtpCredentialFilters, "limit" | "offset">): Promise<number> {
    const where = this.buildCredentialsWhere(filters);
    const rows = await this.database.query<CountRow[]>(
      `SELECT COUNT(*) AS total
       FROM smtp_users
       ${where.whereSql}`,
      where.params,
    );

    return Number(rows[0]?.total ?? 0);
  }

  async listActiveSendersForLogins(
    logins: string[],
    connection?: PoolConnection,
  ): Promise<Map<string, string[]>> {
    if (logins.length === 0) return new Map();

    const executor = connection ?? this.database;
    const placeholders = logins.map(() => "?").join(", ");
    const rows = await runQuery<SenderRow[]>(
      executor,
      `SELECT login, sender
       FROM smtp_sender_acl
       WHERE active = 1
         AND login IN (${placeholders})
       ORDER BY sender ASC`,
      logins,
    );

    const out = new Map<string, string[]>();
    for (const row of rows) {
      const existing = out.get(row.login) ?? [];
      existing.push(row.sender);
      out.set(row.login, existing);
    }
    return out;
  }

  async createUser(
    payload: { username: string; passwordHash: string; active: boolean },
    connection: PoolConnection,
  ): Promise<{ ok: boolean; insertId: number | null }> {
    const result = await runQuery<InsertResult>(
      connection,
      `INSERT INTO smtp_users (username, password, active, created_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP())`,
      [payload.username, payload.passwordHash, payload.active ? 1 : 0],
    );

    return {
      ok: Boolean(result?.affectedRows === 1),
      insertId: result?.insertId != null ? Number(result.insertId) : null,
    };
  }

  async updateUser(
    username: string,
    patch: { passwordHash?: string | undefined; active?: boolean | undefined },
    connection: PoolConnection,
  ): Promise<void> {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (patch.passwordHash !== undefined) {
      updates.push("password = ?");
      params.push(patch.passwordHash);
    }
    if (patch.active !== undefined) {
      updates.push("active = ?");
      params.push(patch.active ? 1 : 0);
    }
    if (updates.length === 0) return;

    await runQuery<InsertResult>(
      connection,
      `UPDATE smtp_users
       SET ${updates.join(", ")}
       WHERE username = ?
       LIMIT 1`,
      [...params, username],
    );
  }

  async deleteUser(username: string, connection: PoolConnection): Promise<void> {
    await runQuery<InsertResult>(
      connection,
      `DELETE FROM smtp_users
       WHERE username = ?
       LIMIT 1`,
      [username],
    );
  }

  async deleteAclByLogin(login: string, connection: PoolConnection): Promise<void> {
    await runQuery<InsertResult>(
      connection,
      `DELETE FROM smtp_sender_acl
       WHERE login = ?`,
      [login],
    );
  }

  async replaceAllowedSenders(
    login: string,
    senders: string[],
    connection: PoolConnection,
  ): Promise<void> {
    await this.deleteAclByLogin(login, connection);
    if (senders.length === 0) return;

    const valuesSql = senders.map(() => "(?, ?, 1)").join(", ");
    const params = senders.flatMap((sender) => [login, sender]);
    await runQuery<InsertResult>(
      connection,
      `INSERT INTO smtp_sender_acl (login, sender, active)
       VALUES ${valuesSql}
       ON DUPLICATE KEY UPDATE active = VALUES(active)`,
      params,
    );
  }

  async createInvite(
    payload: {
      tokenHash: Buffer;
      createdBy: string;
      allowedSenderConstraint: string | null;
      expiresAt: Date;
    },
    connection?: PoolConnection,
  ): Promise<SmtpInviteTokenRow> {
    const executor = connection ?? this.database;
    const result = await runQuery<InsertResult>(
      executor,
      `INSERT INTO smtp_invite_tokens
         (token_hash, created_by, allowed_sender_constraint, expires_at)
       VALUES (?, ?, ?, ?)`,
      [
        payload.tokenHash,
        payload.createdBy,
        payload.allowedSenderConstraint,
        payload.expiresAt,
      ],
    );

    const insertId = result?.insertId != null ? Number(result.insertId) : 0;
    return this.getInviteById(insertId, connection);
  }

  async getInviteById(
    id: number,
    connection?: PoolConnection,
  ): Promise<SmtpInviteTokenRow> {
    const executor = connection ?? this.database;
    const rows = await runQuery<SmtpInviteTokenRow[]>(
      executor,
      `SELECT ${SMTP_INVITE_COLUMNS}
       FROM smtp_invite_tokens
       WHERE id = ?
       LIMIT 1`,
      [id],
    );
    if (!rows[0]) {
      throw new Error("smtp_invite_insert_missing");
    }
    return rows[0];
  }

  async getPendingInviteByTokenHash(
    tokenHash: Buffer,
    connection?: PoolConnection,
    options: { forUpdate?: boolean } = {},
  ): Promise<SmtpInviteTokenRow | null> {
    const executor = connection ?? this.database;
    const lockClause = options.forUpdate ? " FOR UPDATE" : "";
    const rows = await runQuery<SmtpInviteTokenRow[]>(
      executor,
      `SELECT ${SMTP_INVITE_COLUMNS}
       FROM smtp_invite_tokens
       WHERE token_hash = ?
         AND is_used = 0
         AND expires_at > CURRENT_TIMESTAMP()
       LIMIT 1${lockClause}`,
      [tokenHash],
    );

    return rows[0] ?? null;
  }

  async markInviteUsed(
    id: number,
    createdUsername: string,
    connection: PoolConnection,
  ): Promise<boolean> {
    const result = await runQuery<InsertResult>(
      connection,
      `UPDATE smtp_invite_tokens
       SET is_used = 1,
           used_at = CURRENT_TIMESTAMP(),
           created_username = ?
       WHERE id = ?
         AND is_used = 0
         AND expires_at > CURRENT_TIMESTAMP()
       LIMIT 1`,
      [createdUsername, id],
    );

    return Boolean(result?.affectedRows === 1);
  }

  private buildCredentialsWhere(filters: {
    active?: number | undefined;
    username?: string | undefined;
    sender?: string | undefined;
  }): { whereSql: string; params: unknown[] } {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filters.active === 0 || filters.active === 1) {
      where.push("active = ?");
      params.push(filters.active);
    }

    const usernamePattern = buildContainsLikePattern(filters.username);
    if (usernamePattern) {
      where.push("username LIKE ? ESCAPE '\\\\'");
      params.push(usernamePattern);
    }

    const senderPattern = buildContainsLikePattern(filters.sender);
    if (senderPattern) {
      where.push(
        `EXISTS (
          SELECT 1
          FROM smtp_sender_acl acl
          WHERE acl.login = smtp_users.username
            AND acl.active = 1
            AND acl.sender LIKE ? ESCAPE '\\\\'
        )`,
      );
      params.push(senderPattern);
    }

    return {
      whereSql: where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
      params,
    };
  }
}
