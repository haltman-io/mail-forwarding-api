import { Injectable } from "@nestjs/common";
import type { PoolConnection } from "mariadb";

import { DatabaseService } from "../../shared/database/database.service.js";
import { CountRow, InsertResult, runQuery } from "./admin-database.utils.js";
import { buildContainsLikePattern } from "./admin.utils.js";

export interface AdminDomainRow {
  id: number;
  name: string;
  active: number;
}

@Injectable()
export class AdminDomainsRepository {
  constructor(private readonly database: DatabaseService) {}

  async getById(
    id: number,
    connection?: PoolConnection,
    options: { forUpdate?: boolean } = {},
  ): Promise<AdminDomainRow | null> {
    const executor = connection ?? this.database;
    const lockClause = options.forUpdate ? " FOR UPDATE" : "";
    const rows = await runQuery<AdminDomainRow[]>(
      executor,
      `SELECT id, name, active
       FROM domain
       WHERE id = ?
       LIMIT 1${lockClause}`,
      [id],
    );

    return rows[0] ?? null;
  }

  async getByName(
    name: string,
    connection?: PoolConnection,
    options: { forUpdate?: boolean } = {},
  ): Promise<AdminDomainRow | null> {
    const executor = connection ?? this.database;
    const lockClause = options.forUpdate ? " FOR UPDATE" : "";
    const rows = await runQuery<AdminDomainRow[]>(
      executor,
      `SELECT id, name, active
       FROM domain
       WHERE name = ?
       LIMIT 1${lockClause}`,
      [name],
    );

    return rows[0] ?? null;
  }

  async getActiveByName(
    name: string,
    connection?: PoolConnection,
  ): Promise<AdminDomainRow | null> {
    const executor = connection ?? this.database;
    const rows = await runQuery<AdminDomainRow[]>(
      executor,
      `SELECT id, name, active
       FROM domain
       WHERE name = ?
         AND active = 1
       LIMIT 1`,
      [name],
    );

    return rows[0] ?? null;
  }

  async listAll(input: {
    limit: number;
    offset: number;
    active?: number | undefined;
    name?: string | undefined;
  }): Promise<AdminDomainRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (input.active === 0 || input.active === 1) {
      where.push("active = ?");
      params.push(input.active);
    }

    const namePattern = buildContainsLikePattern(input.name);
    if (namePattern) {
      where.push("name LIKE ? ESCAPE '\\\\'");
      params.push(namePattern);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    return this.database.query<AdminDomainRow[]>(
      `SELECT id, name, active
       FROM domain
       ${whereSql}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...params, input.limit, input.offset],
    );
  }

  async countAll(input: { active?: number | undefined; name?: string | undefined }): Promise<number> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (input.active === 0 || input.active === 1) {
      where.push("active = ?");
      params.push(input.active);
    }

    const namePattern = buildContainsLikePattern(input.name);
    if (namePattern) {
      where.push("name LIKE ? ESCAPE '\\\\'");
      params.push(namePattern);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await this.database.query<CountRow[]>(
      `SELECT COUNT(*) AS total
       FROM domain
       ${whereSql}`,
      params,
    );

    return Number(rows[0]?.total ?? 0);
  }

  async createDomain(
    payload: { name: string; active: number },
    connection?: PoolConnection,
  ): Promise<{ ok: boolean; insertId: number | null }> {
    const executor = connection ?? this.database;
    const result = await runQuery<InsertResult>(
      executor,
      `INSERT INTO domain (name, active)
       VALUES (?, ?)`,
      [payload.name, payload.active ? 1 : 0],
    );

    return {
      ok: Boolean(result?.affectedRows === 1),
      insertId: result?.insertId != null ? Number(result.insertId) : null,
    };
  }

  async updateById(
    id: number,
    patch: { name?: string; active?: number },
    connection?: PoolConnection,
  ): Promise<boolean> {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (patch.name !== undefined) {
      updates.push("name = ?");
      params.push(patch.name);
    }
    if (patch.active === 0 || patch.active === 1) {
      updates.push("active = ?");
      params.push(patch.active);
    }
    if (updates.length === 0) return false;

    const executor = connection ?? this.database;
    const result = await runQuery<InsertResult>(
      executor,
      `UPDATE domain
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
      `DELETE FROM domain
       WHERE id = ?
       LIMIT 1`,
      [id],
    );

    return Boolean(result?.affectedRows === 1);
  }
}
