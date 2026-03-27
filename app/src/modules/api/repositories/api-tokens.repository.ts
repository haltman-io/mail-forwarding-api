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
      `SELECT id, owner_email, status, created_at, expires_at, revoked_at
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
    createdIpPacked: Buffer | null;
    userAgentOrNull: string | null;
  }, connection?: PoolConnection): Promise<{ ok: boolean; insertId: number | null }> {
    if (!Buffer.isBuffer(payload.tokenHash32) || payload.tokenHash32.length !== 32) {
      throw new Error("invalid_token_hash");
    }

    const numDays = Number(payload.days);
    if (!Number.isInteger(numDays) || numDays <= 0 || numDays > 90) {
      throw new Error("invalid_days");
    }

    const executor = connection ?? this.database;
    const result = await runQuery<InsertResult>(
      executor,
      `INSERT INTO api_tokens (
        owner_email, token_hash, status, created_at, expires_at,
        created_ip, user_agent
      ) VALUES (
        ?, ?, 'active', NOW(6), DATE_ADD(NOW(6), INTERVAL ? DAY),
        ?, ?
      )`,
      [
        payload.ownerEmail,
        payload.tokenHash32,
        numDays,
        payload.createdIpPacked,
        payload.userAgentOrNull ?? null,
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
}
