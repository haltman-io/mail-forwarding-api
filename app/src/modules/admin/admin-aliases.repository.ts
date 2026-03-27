import { Injectable } from "@nestjs/common";
import type { PoolConnection } from "mariadb";

import { DatabaseService } from "../../shared/database/database.service.js";
import {
  CountRow,
  ExistsRow,
  InsertResult,
  runQuery,
} from "./admin-database.utils.js";
import { buildContainsLikePattern } from "./admin.utils.js";

export interface AdminAliasRow {
  id: number;
  address: string;
  goto: string;
  active: number;
  domain_id: number | null;
  created: Date | string;
  modified: Date | string;
}

@Injectable()
export class AdminAliasesRepository {
  constructor(private readonly database: DatabaseService) {}

  async getById(
    id: number,
    connection?: PoolConnection,
    options: { forUpdate?: boolean } = {},
  ): Promise<AdminAliasRow | null> {
    const executor = connection ?? this.database;
    const lockClause = options.forUpdate ? " FOR UPDATE" : "";
    const rows = await runQuery<AdminAliasRow[]>(
      executor,
      `SELECT a.id, a.address, a.goto, a.active, d.id AS domain_id, a.created, a.modified
       FROM alias a
       LEFT JOIN domain d
         ON d.name = SUBSTRING_INDEX(a.address, '@', -1)
       WHERE a.id = ?
       LIMIT 1${lockClause}`,
      [id],
    );

    return rows[0] ?? null;
  }

  async getByAddress(
    address: string,
    connection?: PoolConnection,
    options: { forUpdate?: boolean } = {},
  ): Promise<AdminAliasRow | null> {
    const executor = connection ?? this.database;
    const lockClause = options.forUpdate ? " FOR UPDATE" : "";
    const rows = await runQuery<AdminAliasRow[]>(
      executor,
      `SELECT a.id, a.address, a.goto, a.active, d.id AS domain_id, a.created, a.modified
       FROM alias a
       LEFT JOIN domain d
         ON d.name = SUBSTRING_INDEX(a.address, '@', -1)
       WHERE a.address = ?
       LIMIT 1${lockClause}`,
      [address],
    );

    return rows[0] ?? null;
  }

  async listAll(input: {
    limit: number;
    offset: number;
    active?: number | undefined;
    goto?: string | undefined;
    domain?: string | undefined;
    handle?: string | undefined;
    address?: string | undefined;
  }): Promise<AdminAliasRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (input.active === 0 || input.active === 1) {
      where.push("a.active = ?");
      params.push(input.active);
    }

    const gotoPattern = buildContainsLikePattern(input.goto);
    if (gotoPattern) {
      where.push("a.goto LIKE ? ESCAPE '\\\\'");
      params.push(gotoPattern);
    }

    const domainPattern = buildContainsLikePattern(input.domain);
    if (domainPattern) {
      where.push("SUBSTRING_INDEX(a.address, '@', -1) LIKE ? ESCAPE '\\\\'");
      params.push(domainPattern);
    }

    const handlePattern = buildContainsLikePattern(input.handle);
    if (handlePattern) {
      where.push("SUBSTRING_INDEX(a.address, '@', 1) LIKE ? ESCAPE '\\\\'");
      params.push(handlePattern);
    }

    const addressPattern = buildContainsLikePattern(input.address);
    if (addressPattern) {
      where.push("a.address LIKE ? ESCAPE '\\\\'");
      params.push(addressPattern);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    return this.database.query<AdminAliasRow[]>(
      `SELECT a.id, a.address, a.goto, a.active, d.id AS domain_id, a.created, a.modified
       FROM alias a
       LEFT JOIN domain d
         ON d.name = SUBSTRING_INDEX(a.address, '@', -1)
       ${whereSql}
       ORDER BY a.id DESC
       LIMIT ? OFFSET ?`,
      [...params, input.limit, input.offset],
    );
  }

  async countAll(input: {
    active?: number | undefined;
    goto?: string | undefined;
    domain?: string | undefined;
    handle?: string | undefined;
    address?: string | undefined;
  }): Promise<number> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (input.active === 0 || input.active === 1) {
      where.push("active = ?");
      params.push(input.active);
    }

    const gotoPattern = buildContainsLikePattern(input.goto);
    if (gotoPattern) {
      where.push("goto LIKE ? ESCAPE '\\\\'");
      params.push(gotoPattern);
    }

    const domainPattern = buildContainsLikePattern(input.domain);
    if (domainPattern) {
      where.push("SUBSTRING_INDEX(address, '@', -1) LIKE ? ESCAPE '\\\\'");
      params.push(domainPattern);
    }

    const handlePattern = buildContainsLikePattern(input.handle);
    if (handlePattern) {
      where.push("SUBSTRING_INDEX(address, '@', 1) LIKE ? ESCAPE '\\\\'");
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
       FROM alias
       ${whereSql}`,
      params,
    );

    return Number(rows[0]?.total ?? 0);
  }

  async createAlias(
    payload: { address: string; goto: string; active: number },
    connection?: PoolConnection,
  ): Promise<{ ok: boolean; insertId: number | null }> {
    const executor = connection ?? this.database;
    const result = await runQuery<InsertResult>(
      executor,
      `INSERT INTO alias (address, goto, active, created, modified)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
      [payload.address, payload.goto, payload.active ? 1 : 0],
    );

    return {
      ok: Boolean(result?.affectedRows === 1),
      insertId: result?.insertId != null ? Number(result.insertId) : null,
    };
  }

  async updateById(
    id: number,
    patch: { address?: string; goto?: string; active?: number },
    connection?: PoolConnection,
  ): Promise<boolean> {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (patch.address !== undefined) {
      updates.push("address = ?");
      params.push(patch.address);
    }
    if (patch.goto !== undefined) {
      updates.push("goto = ?");
      params.push(patch.goto);
    }
    if (patch.active === 0 || patch.active === 1) {
      updates.push("active = ?");
      params.push(patch.active);
    }
    if (updates.length === 0) return false;

    updates.push("modified = CURRENT_TIMESTAMP()");

    const executor = connection ?? this.database;
    const result = await runQuery<InsertResult>(
      executor,
      `UPDATE alias
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
      `DELETE FROM alias
       WHERE id = ?
       LIMIT 1`,
      [id],
    );

    return Boolean(result?.affectedRows === 1);
  }

  async existsReservedHandle(
    handle: string,
    connection?: PoolConnection,
    options: { forUpdate?: boolean } = {},
  ): Promise<boolean> {
    const executor = connection ?? this.database;
    const lockClause = options.forUpdate ? " FOR UPDATE" : "";
    const rows = await runQuery<ExistsRow[]>(
      executor,
      `SELECT 1 AS ok
       FROM alias_handle
       WHERE handle = ?
         AND active = 1
       LIMIT 1${lockClause}`,
      [handle],
    );

    return rows.length === 1;
  }

  async existsActiveAliasByLocalPart(
    handle: string,
    connection?: PoolConnection,
    options: { forUpdate?: boolean } = {},
  ): Promise<boolean> {
    const executor = connection ?? this.database;
    const lockClause = options.forUpdate ? " FOR UPDATE" : "";
    const rows = await runQuery<ExistsRow[]>(
      executor,
      `SELECT 1 AS ok
       FROM alias
       WHERE SUBSTRING_INDEX(address, '@', 1) = ?
         AND active = 1
       LIMIT 1${lockClause}`,
      [handle],
    );

    return rows.length === 1;
  }
}
