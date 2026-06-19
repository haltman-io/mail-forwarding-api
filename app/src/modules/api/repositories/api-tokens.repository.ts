import { Injectable } from "@nestjs/common";
import type { PoolConnection } from "mariadb";

import { DatabaseService } from "../../../shared/database/database.service.js";

export interface ApiTokenRow {
  id: number;
  owner_email: string;
  status: string;
  created_at: Date | string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
  automatic_renew: number;
  last_used_at?: Date | string | null;
}

export interface ApiTokenPublicMetadata {
  id: number;
  owner_email: string;
  status: string;
  created_at: Date | string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
  last_used_at: Date | string | null;
  automatic_renew: number;
  active: boolean;
}

interface InsertResult {
  affectedRows: number;
  insertId: number | bigint | null;
}

function runQuery<T>(
  executor: DatabaseService | PoolConnection,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T> {
  return (
    executor as {
      query: (statement: string, values?: readonly unknown[]) => Promise<T>;
    }
  ).query(sql, [...params]);
}

@Injectable()
export class ApiTokensRepository {
  constructor(private readonly database: DatabaseService) {}

  async getActiveByTokenHash(tokenHash32: Buffer): Promise<ApiTokenRow | null> {
    if (!Buffer.isBuffer(tokenHash32) || tokenHash32.length !== 32) {
      throw new Error("invalid_token_hash");
    }

    const rows = await this.database.query<ApiTokenRow[]>(
      `SELECT id, owner_email, status, created_at, expires_at, revoked_at,
              automatic_renew
       FROM api_tokens
       WHERE token_hash = ?
         AND status = 'active'
         AND revoked_at IS NULL
         AND expires_at > NOW(6)
       ORDER BY id DESC
       LIMIT 1`,
      [tokenHash32],
    );

    return rows[0] ?? null;
  }

  async createToken(payload: {
    ownerEmail: string;
    tokenHash32: Buffer;
    days: number;
    automaticRenew?: boolean;
    createdIpPacked: Buffer | null;
    userAgentOrNull: string | null;
  }, connection?: PoolConnection): Promise<{ ok: boolean; insertId: number | null }> {
    if (!Buffer.isBuffer(payload.tokenHash32) || payload.tokenHash32.length !== 32) {
      throw new Error("invalid_token_hash");
    }

    const numDays = Number(payload.days);
    if (!Number.isInteger(numDays) || numDays <= 0 || numDays > 9999) {
      throw new Error("invalid_days");
    }

    const executor = connection ?? this.database;
    const result = await runQuery<InsertResult>(
      executor,
      `INSERT INTO api_tokens (
        owner_email, token_hash, status, created_at, expires_at,
        created_ip, user_agent, automatic_renew
      ) VALUES (
        ?, ?, 'active', NOW(6), DATE_ADD(NOW(6), INTERVAL ? DAY),
        ?, ?, ?
      )`,
      [
        payload.ownerEmail,
        payload.tokenHash32,
        numDays,
        payload.createdIpPacked,
        payload.userAgentOrNull ?? null,
        payload.automaticRenew ? 1 : 0,
      ],
    );

    return {
      ok: Boolean(result && result.affectedRows === 1),
      insertId: result?.insertId != null ? Number(result.insertId) : null,
    };
  }

  async touchLastUsed(id: number): Promise<void> {
    await this.database.query(
      `UPDATE api_tokens
       SET last_used_at = NOW(6)
       WHERE id = ?
       LIMIT 1`,
      [id],
    );
  }

  async listActiveByOwnerEmail(ownerEmail: string): Promise<ApiTokenPublicMetadata[]> {
    const rows = await this.database.query<ApiTokenRow[]>(
      `SELECT id, owner_email, status, created_at, expires_at, revoked_at,
              last_used_at, automatic_renew
       FROM api_tokens
       WHERE owner_email = ?
         AND status = 'active'
         AND revoked_at IS NULL
         AND expires_at > NOW(6)
       ORDER BY created_at DESC, id DESC`,
      [ownerEmail],
    );

    return rows.map((row) => ({
      id: row.id,
      owner_email: row.owner_email,
      status: row.status,
      created_at: row.created_at,
      expires_at: row.expires_at,
      revoked_at: row.revoked_at,
      last_used_at: row.last_used_at ?? null,
      automatic_renew: Number(row.automatic_renew ?? 0) === 1 ? 1 : 0,
      active: true,
    }));
  }

  async getActiveMetadataById(id: number): Promise<ApiTokenPublicMetadata | null> {
    const rows = await this.database.query<ApiTokenRow[]>(
      `SELECT id, owner_email, status, created_at, expires_at, revoked_at,
              last_used_at, automatic_renew
       FROM api_tokens
       WHERE id = ?
         AND status = 'active'
         AND revoked_at IS NULL
         AND expires_at > NOW(6)
       LIMIT 1`,
      [id],
    );

    const row = rows[0] ?? null;
    if (!row) return null;

    return {
      id: row.id,
      owner_email: row.owner_email,
      status: row.status,
      created_at: row.created_at,
      expires_at: row.expires_at,
      revoked_at: row.revoked_at,
      last_used_at: row.last_used_at ?? null,
      automatic_renew: Number(row.automatic_renew ?? 0) === 1 ? 1 : 0,
      active: true,
    };
  }

  async countByOwnerEmail(ownerEmail: string, connection?: PoolConnection): Promise<number> {
    const executor = connection ?? this.database;
    const rows = await runQuery<Array<{ total: number | string | bigint | null }>>(
      executor,
      `SELECT COUNT(*) AS total
       FROM api_tokens
       WHERE owner_email = ?`,
      [ownerEmail],
    );

    return Number(rows[0]?.total ?? 0);
  }

  async deleteByOwnerEmail(ownerEmail: string, connection?: PoolConnection): Promise<number> {
    const executor = connection ?? this.database;
    const result = await runQuery<InsertResult>(
      executor,
      `DELETE FROM api_tokens
       WHERE owner_email = ?`,
      [ownerEmail],
    );

    return Number(result?.affectedRows ?? 0);
  }

  async renewActiveById(id: number, days: number): Promise<boolean> {
    if (!Number.isInteger(days) || days <= 0 || days > 999) {
      throw new Error("invalid_days");
    }

    const result = await this.database.query<InsertResult>(
      `UPDATE api_tokens
       SET expires_at = DATE_ADD(expires_at, INTERVAL ? DAY)
       WHERE id = ?
         AND status = 'active'
         AND revoked_at IS NULL
         AND expires_at > NOW(6)
       LIMIT 1`,
      [days, id],
    );

    return Boolean(result?.affectedRows === 1);
  }

  async setAutomaticRenewById(id: number, automaticRenew: boolean): Promise<boolean> {
    const result = await this.database.query<InsertResult>(
      `UPDATE api_tokens
       SET automatic_renew = ?
       WHERE id = ?
         AND status = 'active'
         AND revoked_at IS NULL
         AND expires_at > NOW(6)
       LIMIT 1`,
      [automaticRenew ? 1 : 0, id],
    );

    return Boolean(result?.affectedRows === 1);
  }

  async extendAutomaticRenewIfDue(id: number): Promise<boolean> {
    const result = await this.database.query<InsertResult>(
      `UPDATE api_tokens
       SET expires_at = DATE_ADD(expires_at, INTERVAL 90 DAY)
       WHERE id = ?
         AND status = 'active'
         AND revoked_at IS NULL
         AND automatic_renew = 1
         AND expires_at > NOW(6)
         AND expires_at <= DATE_ADD(NOW(6), INTERVAL 7 DAY)
       LIMIT 1`,
      [id],
    );

    return Boolean(result?.affectedRows === 1);
  }

  async deleteActiveById(id: number): Promise<boolean> {
    const result = await this.database.query<InsertResult>(
      `DELETE FROM api_tokens
       WHERE id = ?
         AND status = 'active'
         AND revoked_at IS NULL
         AND expires_at > NOW(6)
       LIMIT 1`,
      [id],
    );

    return Boolean(result?.affectedRows === 1);
  }
}
