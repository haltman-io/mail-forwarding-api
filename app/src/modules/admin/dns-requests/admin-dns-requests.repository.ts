import type { PoolConnection } from "mariadb";
import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../../../shared/database/database.service.js";
import { CountRow, InsertResult, runQuery } from "../utils/admin-database.utils.js";
import { buildContainsLikePattern } from "../utils/admin.utils.js";

export interface AdminDnsRequestRow {
  id: number;
  target: string;
  type: string;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
  activated_at: Date | string | null;
  last_checked_at: Date | string | null;
  next_check_at: Date | string | null;
  last_check_result_json: string | null;
  fail_reason: string | null;
  expires_at: Date | string;
}

@Injectable()
export class AdminDnsRequestsRepository {
  constructor(private readonly database: DatabaseService) {}

  async getById(
    id: number,
    connection?: PoolConnection,
    options: { forUpdate?: boolean } = {},
  ): Promise<AdminDnsRequestRow | null> {
    const executor = connection ?? this.database;
    const lockClause = options.forUpdate ? " FOR UPDATE" : "";
    const rows = await runQuery<AdminDnsRequestRow[]>(
      executor,
      `SELECT
          id,
          target,
          type,
          status,
          created_at,
          updated_at,
          activated_at,
          last_checked_at,
          next_check_at,
          last_check_result_json,
          fail_reason,
          expires_at
       FROM dns_requests
       WHERE id = ?
       LIMIT 1${lockClause}`,
      [id],
    );

    return rows[0] ?? null;
  }

  async getByTargetType(
    target: string,
    type: string,
    connection?: PoolConnection,
    options: { forUpdate?: boolean } = {},
  ): Promise<AdminDnsRequestRow | null> {
    const executor = connection ?? this.database;
    const lockClause = options.forUpdate ? " FOR UPDATE" : "";
    const rows = await runQuery<AdminDnsRequestRow[]>(
      executor,
      `SELECT
          id,
          target,
          type,
          status,
          created_at,
          updated_at,
          activated_at,
          last_checked_at,
          next_check_at,
          last_check_result_json,
          fail_reason,
          expires_at
       FROM dns_requests
       WHERE target = ?
         AND type = ?
       LIMIT 1${lockClause}`,
      [target, type],
    );

    return rows[0] ?? null;
  }

  async listAll(input: {
    limit: number;
    offset: number;
    target?: string | undefined;
    type?: string | undefined;
    status?: string | undefined;
  }): Promise<AdminDnsRequestRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];

    const targetPattern = buildContainsLikePattern(input.target);
    if (targetPattern) {
      where.push("target LIKE ? ESCAPE '\\\\'");
      params.push(targetPattern);
    }

    if (input.type) {
      where.push("type = ?");
      params.push(input.type);
    }

    if (input.status) {
      where.push("status = ?");
      params.push(input.status);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    return this.database.query<AdminDnsRequestRow[]>(
      `SELECT
          id,
          target,
          type,
          status,
          created_at,
          updated_at,
          activated_at,
          last_checked_at,
          next_check_at,
          last_check_result_json,
          fail_reason,
          expires_at
       FROM dns_requests
       ${whereSql}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...params, input.limit, input.offset],
    );
  }

  async countAll(input: {
    target?: string | undefined;
    type?: string | undefined;
    status?: string | undefined;
  }): Promise<number> {
    const where: string[] = [];
    const params: unknown[] = [];

    const targetPattern = buildContainsLikePattern(input.target);
    if (targetPattern) {
      where.push("target LIKE ? ESCAPE '\\\\'");
      params.push(targetPattern);
    }

    if (input.type) {
      where.push("type = ?");
      params.push(input.type);
    }

    if (input.status) {
      where.push("status = ?");
      params.push(input.status);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await this.database.query<CountRow[]>(
      `SELECT COUNT(*) AS total
       FROM dns_requests
       ${whereSql}`,
      params,
    );

    return Number(rows[0]?.total ?? 0);
  }

  async createDnsRequest(
    payload: {
      target: string;
      type: string;
      status: string;
      activatedAt: Date | null;
      lastCheckedAt: Date | null;
      nextCheckAt: Date | null;
      lastCheckResultJson: string | null;
      failReason: string | null;
      expiresAt: Date;
    },
    connection?: PoolConnection,
  ): Promise<{ ok: boolean; insertId: number | null }> {
    const executor = connection ?? this.database;
    const result = await runQuery<InsertResult>(
      executor,
      `INSERT INTO dns_requests (
         target,
         type,
         status,
         activated_at,
         last_checked_at,
         next_check_at,
         last_check_result_json,
         fail_reason,
         expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.target,
        payload.type,
        payload.status,
        payload.activatedAt,
        payload.lastCheckedAt,
        payload.nextCheckAt,
        payload.lastCheckResultJson,
        payload.failReason,
        payload.expiresAt,
      ],
    );

    return {
      ok: Boolean(result?.affectedRows === 1),
      insertId: result?.insertId != null ? Number(result.insertId) : null,
    };
  }

  async updateById(
    id: number,
    patch: {
      target?: string;
      type?: string;
      status?: string;
      activatedAt?: Date | null;
      lastCheckedAt?: Date | null;
      nextCheckAt?: Date | null;
      lastCheckResultJson?: string | null;
      failReason?: string | null;
      expiresAt?: Date;
    },
    connection?: PoolConnection,
  ): Promise<boolean> {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (patch.target !== undefined) {
      updates.push("target = ?");
      params.push(patch.target);
    }
    if (patch.type !== undefined) {
      updates.push("type = ?");
      params.push(patch.type);
    }
    if (patch.status !== undefined) {
      updates.push("status = ?");
      params.push(patch.status);
    }
    if (patch.activatedAt !== undefined) {
      updates.push("activated_at = ?");
      params.push(patch.activatedAt);
    }
    if (patch.lastCheckedAt !== undefined) {
      updates.push("last_checked_at = ?");
      params.push(patch.lastCheckedAt);
    }
    if (patch.nextCheckAt !== undefined) {
      updates.push("next_check_at = ?");
      params.push(patch.nextCheckAt);
    }
    if (patch.lastCheckResultJson !== undefined) {
      updates.push("last_check_result_json = ?");
      params.push(patch.lastCheckResultJson);
    }
    if (patch.failReason !== undefined) {
      updates.push("fail_reason = ?");
      params.push(patch.failReason);
    }
    if (patch.expiresAt !== undefined) {
      updates.push("expires_at = ?");
      params.push(patch.expiresAt);
    }
    if (updates.length === 0) return false;

    const executor = connection ?? this.database;
    const result = await runQuery<InsertResult>(
      executor,
      `UPDATE dns_requests
       SET ${updates.join(", ")}
       WHERE id = ?
       LIMIT 1`,
      [...params, id],
    );

    return Boolean(result?.affectedRows === 1);
  }

  async deleteById(id: number, connection?: PoolConnection): Promise<boolean> {
    const executor = connection ?? this.database;
    const result = await runQuery<InsertResult>(
      executor,
      `DELETE FROM dns_requests
       WHERE id = ?
       LIMIT 1`,
      [id],
    );

    return Boolean(result?.affectedRows === 1);
  }
}
