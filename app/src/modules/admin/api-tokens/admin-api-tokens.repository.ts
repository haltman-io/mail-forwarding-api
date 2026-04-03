import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../../../shared/database/database.service.js";
import { CountRow, InsertResult } from "../utils/admin-database.utils.js";
import { buildContainsLikePattern } from "../utils/admin.utils.js";

export interface AdminApiTokenRow {
  id: number;
  owner_email: string;
  status: string;
  created_at: Date | string;
  expires_at: Date | string | null;
  revoked_at: Date | string | null;
  revoked_reason: string | null;
  created_ip: string | null;
  user_agent: string | null;
  last_used_at: Date | string | null;
}

@Injectable()
export class AdminApiTokensRepository {
  constructor(private readonly database: DatabaseService) {}

  async getById(id: number): Promise<AdminApiTokenRow | null> {
    const rows = await this.database.query<AdminApiTokenRow[]>(
      `SELECT
          id,
          owner_email,
          status,
          created_at,
          expires_at,
          revoked_at,
          revoked_reason,
          INET6_NTOA(created_ip) AS created_ip,
          user_agent,
          last_used_at
       FROM api_tokens
       WHERE id = ?
       LIMIT 1`,
      [id],
    );

    return rows[0] ?? null;
  }

  async listAll(input: {
    limit: number;
    offset: number;
    ownerEmail?: string | undefined;
    status?: string | undefined;
    active?: number | undefined;
  }): Promise<AdminApiTokenRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];

    const ownerEmailPattern = buildContainsLikePattern(input.ownerEmail);
    if (ownerEmailPattern) {
      where.push("owner_email LIKE ? ESCAPE '\\\\'");
      params.push(ownerEmailPattern);
    }

    if (input.status) {
      where.push("status = ?");
      params.push(input.status);
    }

    if (input.active === 1) {
      where.push("status = 'active' AND revoked_at IS NULL AND expires_at > NOW(6)");
    } else if (input.active === 0) {
      where.push("NOT (status = 'active' AND revoked_at IS NULL AND expires_at > NOW(6))");
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    return this.database.query<AdminApiTokenRow[]>(
      `SELECT
          id,
          owner_email,
          status,
          created_at,
          expires_at,
          revoked_at,
          revoked_reason,
          INET6_NTOA(created_ip) AS created_ip,
          user_agent,
          last_used_at
       FROM api_tokens
       ${whereSql}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...params, input.limit, input.offset],
    );
  }

  async countAll(input: {
    ownerEmail?: string | undefined;
    status?: string | undefined;
    active?: number | undefined;
  }): Promise<number> {
    const where: string[] = [];
    const params: unknown[] = [];

    const ownerEmailPattern = buildContainsLikePattern(input.ownerEmail);
    if (ownerEmailPattern) {
      where.push("owner_email LIKE ? ESCAPE '\\\\'");
      params.push(ownerEmailPattern);
    }

    if (input.status) {
      where.push("status = ?");
      params.push(input.status);
    }

    if (input.active === 1) {
      where.push("status = 'active' AND revoked_at IS NULL AND expires_at > NOW(6)");
    } else if (input.active === 0) {
      where.push("NOT (status = 'active' AND revoked_at IS NULL AND expires_at > NOW(6))");
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await this.database.query<CountRow[]>(
      `SELECT COUNT(*) AS total
       FROM api_tokens
       ${whereSql}`,
      params,
    );

    return Number(rows[0]?.total ?? 0);
  }

  async createToken(payload: {
    ownerEmail: string;
    tokenHash32: Buffer;
    days: number;
    createdIpPacked: Buffer | null;
    userAgentOrNull: string | null;
  }): Promise<{ ok: boolean; insertId: number | null }> {
    if (!Buffer.isBuffer(payload.tokenHash32) || payload.tokenHash32.length !== 32) {
      throw new Error("invalid_token_hash");
    }

    const days = Number(payload.days);
    if (!Number.isInteger(days) || days <= 0 || days > 90) {
      throw new Error("invalid_days");
    }

    const result = await this.database.query<InsertResult>(
      `INSERT INTO api_tokens (
        owner_email, token_hash, status, created_at, expires_at, created_ip, user_agent
      ) VALUES (
        ?, ?, 'active', NOW(6), DATE_ADD(NOW(6), INTERVAL ? DAY), ?, ?
      )`,
      [
        payload.ownerEmail,
        payload.tokenHash32,
        days,
        payload.createdIpPacked,
        payload.userAgentOrNull ?? null,
      ],
    );

    return {
      ok: Boolean(result?.affectedRows === 1),
      insertId: result?.insertId != null ? Number(result.insertId) : null,
    };
  }

  async updateById(id: number, patch: {
    ownerEmail?: string;
    status?: string;
    expiresAt?: Date;
    revokedAt?: Date | null;
    revokedReason?: string | null;
  }): Promise<boolean> {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (patch.ownerEmail !== undefined) {
      updates.push("owner_email = ?");
      params.push(patch.ownerEmail);
    }
    if (patch.status !== undefined) {
      updates.push("status = ?");
      params.push(patch.status);
    }
    if (patch.expiresAt !== undefined) {
      updates.push("expires_at = ?");
      params.push(patch.expiresAt);
    }
    if (patch.revokedAt !== undefined) {
      updates.push("revoked_at = ?");
      params.push(patch.revokedAt);
    }
    if (patch.revokedReason !== undefined) {
      updates.push("revoked_reason = ?");
      params.push(patch.revokedReason);
    }
    if (updates.length === 0) return false;

    const result = await this.database.query<InsertResult>(
      `UPDATE api_tokens
       SET ${updates.join(", ")}
       WHERE id = ?
       LIMIT 1`,
      [...params, id],
    );

    return Boolean(result?.affectedRows === 1);
  }

  async deleteById(id: number): Promise<boolean> {
    const result = await this.database.query<InsertResult>(
      `DELETE FROM api_tokens
       WHERE id = ?
       LIMIT 1`,
      [id],
    );

    return Boolean(result?.affectedRows === 1);
  }
}
