import { Injectable } from "@nestjs/common";
import type { PoolConnection } from "mariadb";

import { DatabaseService } from "../../../shared/database/database.service.js";
import { CountRow, InsertResult, runQuery } from "../utils/admin-database.utils.js";
import { buildContainsLikePattern } from "../utils/admin.utils.js";

export interface AdminBanRow {
  id: number;
  ban_type: string;
  ban_value: string;
  reason: string | null;
  created_at: Date | string;
  expires_at: Date | string | null;
  revoked_at: Date | string | null;
  revoked_reason: string | null;
}

const ACTIVE_WHERE =
  "revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW(6))";

@Injectable()
export class AdminBansRepository {
  constructor(private readonly database: DatabaseService) {}

  async getById(id: number): Promise<AdminBanRow | null> {
    const rows = await this.database.query<AdminBanRow[]>(
      `SELECT id, ban_type, ban_value, reason, created_at, expires_at, revoked_at, revoked_reason
       FROM api_bans
       WHERE id = ?
       LIMIT 1`,
      [id],
    );

    return rows[0] ?? null;
  }

  async listAll(input: {
    limit: number;
    offset: number;
    banType?: string | undefined;
    banValue?: string | undefined;
    active?: number | undefined;
  }): Promise<AdminBanRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (input.banType) {
      where.push("ban_type = ?");
      params.push(input.banType);
    }

    const banValuePattern = buildContainsLikePattern(input.banValue);
    if (banValuePattern) {
      where.push("ban_value LIKE ? ESCAPE '\\\\'");
      params.push(banValuePattern);
    }

    if (input.active === 1) {
      where.push(ACTIVE_WHERE);
    } else if (input.active === 0) {
      where.push(`NOT (${ACTIVE_WHERE})`);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    return this.database.query<AdminBanRow[]>(
      `SELECT id, ban_type, ban_value, reason, created_at, expires_at, revoked_at, revoked_reason
       FROM api_bans
       ${whereSql}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...params, input.limit, input.offset],
    );
  }

  async countAll(input: {
    banType?: string | undefined;
    banValue?: string | undefined;
    active?: number | undefined;
  }): Promise<number> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (input.banType) {
      where.push("ban_type = ?");
      params.push(input.banType);
    }

    const banValuePattern = buildContainsLikePattern(input.banValue);
    if (banValuePattern) {
      where.push("ban_value LIKE ? ESCAPE '\\\\'");
      params.push(banValuePattern);
    }

    if (input.active === 1) {
      where.push(ACTIVE_WHERE);
    } else if (input.active === 0) {
      where.push(`NOT (${ACTIVE_WHERE})`);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await this.database.query<CountRow[]>(
      `SELECT COUNT(*) AS total
       FROM api_bans
       ${whereSql}`,
      params,
    );

    return Number(rows[0]?.total ?? 0);
  }

  async createBan(payload: {
    banType: string;
    banValue: string;
    reason?: string | null;
    expiresAt?: Date | null;
  }, connection?: PoolConnection): Promise<{ ok: boolean; insertId: number | null }> {
    const executor = connection ?? this.database;
    const result = await runQuery<InsertResult>(
      executor,
      `INSERT INTO api_bans (
        ban_type, ban_value, reason, created_at, expires_at, revoked_at, revoked_reason
      ) VALUES (
        ?, ?, ?, NOW(6), ?, NULL, NULL
      )`,
      [payload.banType, payload.banValue, payload.reason || null, payload.expiresAt || null],
    );

    return {
      ok: Boolean(result?.affectedRows === 1),
      insertId: result?.insertId != null ? Number(result.insertId) : null,
    };
  }

  async updateById(id: number, patch: {
    banType?: string;
    banValue?: string;
    reason?: string | null;
    expiresAt?: Date | null;
    revokedAt?: Date | null;
    revokedReason?: string | null;
  }): Promise<boolean> {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (patch.banType !== undefined) {
      updates.push("ban_type = ?");
      params.push(patch.banType);
    }
    if (patch.banValue !== undefined) {
      updates.push("ban_value = ?");
      params.push(patch.banValue);
    }
    if (patch.reason !== undefined) {
      updates.push("reason = ?");
      params.push(patch.reason);
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
      `UPDATE api_bans
       SET ${updates.join(", ")}
       WHERE id = ?
       LIMIT 1`,
      [...params, id],
    );

    return Boolean(result?.affectedRows === 1);
  }

  async deleteById(id: number): Promise<boolean> {
    const result = await this.database.query<InsertResult>(
      `DELETE FROM api_bans
       WHERE id = ?
       LIMIT 1`,
      [id],
    );

    return Boolean(result?.affectedRows === 1);
  }
}
