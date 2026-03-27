import { Injectable } from "@nestjs/common";
import type { PoolConnection } from "mariadb";

import { DatabaseService } from "../../shared/database/database.service.js";
import {
  CountRow,
  InsertResult,
  runQuery,
} from "./admin-database.utils.js";
import { buildContainsLikePattern } from "./admin.utils.js";

export interface AdminHandleRow {
  id: number;
  handle: string;
  address: string;
  active: number;
}

@Injectable()
export class AdminHandlesRepository {
  constructor(private readonly database: DatabaseService) {}

  async getById(
    id: number,
    connection?: PoolConnection,
    options: { forUpdate?: boolean } = {},
  ): Promise<AdminHandleRow | null> {
    const executor = connection ?? this.database;
    const lockClause = options.forUpdate ? " FOR UPDATE" : "";
    const rows = await runQuery<AdminHandleRow[]>(
      executor,
      `SELECT id, handle, address, active
       FROM alias_handle
       WHERE id = ?
       LIMIT 1${lockClause}`,
      [id],
    );

    return rows[0] ?? null;
  }

  async getByHandle(
    handle: string,
    connection?: PoolConnection,
    options: { forUpdate?: boolean } = {},
  ): Promise<AdminHandleRow | null> {
    const executor = connection ?? this.database;
    const lockClause = options.forUpdate ? " FOR UPDATE" : "";
    const rows = await runQuery<AdminHandleRow[]>(
      executor,
      `SELECT id, handle, address, active
       FROM alias_handle
       WHERE handle = ?
       LIMIT 1${lockClause}`,
      [handle],
    );

    return rows[0] ?? null;
  }

  async listAll(input: {
    limit: number;
    offset: number;
    active?: number | undefined;
    handle?: string | undefined;
    address?: string | undefined;
  }): Promise<AdminHandleRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (input.active === 0 || input.active === 1) {
      where.push("active = ?");
      params.push(input.active);
    }

    const handlePattern = buildContainsLikePattern(input.handle);
    if (handlePattern) {
      where.push("handle LIKE ? ESCAPE '\\\\'");
      params.push(handlePattern);
    }

    const addressPattern = buildContainsLikePattern(input.address);
    if (addressPattern) {
      where.push("address LIKE ? ESCAPE '\\\\'");
      params.push(addressPattern);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    return this.database.query<AdminHandleRow[]>(
      `SELECT id, handle, address, active
       FROM alias_handle
       ${whereSql}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...params, input.limit, input.offset],
    );
  }

  async countAll(input: {
    active?: number | undefined;
    handle?: string | undefined;
    address?: string | undefined;
  }): Promise<number> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (input.active === 0 || input.active === 1) {
      where.push("active = ?");
      params.push(input.active);
    }

    const handlePattern = buildContainsLikePattern(input.handle);
    if (handlePattern) {
      where.push("handle LIKE ? ESCAPE '\\\\'");
      params.push(handlePattern);
    }

    const addressPattern = buildContainsLikePattern(input.address);
    if (addressPattern) {
      where.push("address LIKE ? ESCAPE '\\\\'");
      params.push(addressPattern);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await this.database.query<CountRow[]>(
      `SELECT COUNT(*) AS total
       FROM alias_handle
       ${whereSql}`,
      params,
    );

    return Number(rows[0]?.total ?? 0);
  }

  async createHandle(
    payload: { handle: string; address: string; active: number },
    connection?: PoolConnection,
  ): Promise<{ ok: boolean; insertId: number | null }> {
    const executor = connection ?? this.database;
    const result = await runQuery<InsertResult>(
      executor,
      `INSERT INTO alias_handle (handle, address, active)
       VALUES (?, ?, ?)`,
      [payload.handle, payload.address, payload.active ? 1 : 0],
    );

    return {
      ok: Boolean(result?.affectedRows === 1),
      insertId: result?.insertId != null ? Number(result.insertId) : null,
    };
  }

  async updateById(
    id: number,
    patch: { handle?: string; address?: string; active?: number },
    connection?: PoolConnection,
  ): Promise<boolean> {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (patch.handle !== undefined) {
      updates.push("handle = ?");
      params.push(patch.handle);
    }
    if (patch.address !== undefined) {
      updates.push("address = ?");
      params.push(patch.address);
    }
    if (patch.active === 0 || patch.active === 1) {
      updates.push("active = ?");
      params.push(patch.active);
    }
    if (updates.length === 0) return false;

    const executor = connection ?? this.database;
    const result = await runQuery<InsertResult>(
      executor,
      `UPDATE alias_handle
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
      `DELETE FROM alias_handle
       WHERE id = ?
       LIMIT 1`,
      [id],
    );

    return Boolean(result?.affectedRows === 1);
  }
}
