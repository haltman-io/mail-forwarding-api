import { Injectable } from "@nestjs/common";
import type { PoolConnection } from "mariadb";

import { DatabaseService } from "../../../shared/database/database.service.js";
import { PERMANENT_ALIAS_GOTO } from "../../../shared/utils/alias-policy.js";

export interface AliasRow {
  id: number;
  address: string;
  goto: string;
  active: number;
  domain_id: number | null;
  created: Date | string;
  modified: Date | string;
}

export interface AliasStats {
  totals: number;
  active: number;
  created_last_7d: number;
  modified_last_24h: number;
  by_domain: Array<{ domain: string; total: number; active: number }>;
}

interface CountRow {
  total: number | string | bigint | null;
}

interface TotalsRow {
  totals: number | string | bigint | null;
  active: number | string | bigint | null;
  created_last_7d: number | string | bigint | null;
  modified_last_24h: number | string | bigint | null;
}

interface DomainStatsRow {
  domain: string;
  total: number | string | bigint | null;
  active: number | string | bigint | null;
}

interface InsertResult {
  affectedRows: number;
  insertId: number | bigint | null;
}

interface ExistsRow {
  ok: number;
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
export class AliasRepository {
  constructor(private readonly database: DatabaseService) {}

  async listByGoto(
    goto: string,
    options: { limit: number; offset: number },
  ): Promise<AliasRow[]> {
    if (!goto || typeof goto !== "string") throw new Error("invalid_goto");

    const normalizedGoto = goto.trim().toLowerCase();
    const limit = Number(options.limit);
    const offset = Number(options.offset);
    const hasLimit = Number.isInteger(limit) && limit > 0;
    const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;

    const sqlBase = `SELECT a.id, a.address, a.goto, a.active, d.id AS domain_id, a.created, a.modified
       FROM alias a
       LEFT JOIN domain d
         ON d.name = SUBSTRING_INDEX(a.address, '@', -1)
       WHERE a.goto = ?
       ORDER BY a.id DESC`;

    if (hasLimit) {
      return this.database.query<AliasRow[]>(`${sqlBase} LIMIT ? OFFSET ?`, [
        normalizedGoto,
        limit,
        safeOffset,
      ]);
    }

    return this.database.query<AliasRow[]>(sqlBase, [normalizedGoto]);
  }

  async countByGoto(goto: string): Promise<number> {
    if (!goto || typeof goto !== "string") throw new Error("invalid_goto");

    const rows = await this.database.query<CountRow[]>(
      `SELECT COUNT(*) AS total
       FROM alias
       WHERE goto = ?`,
      [goto.trim().toLowerCase()],
    );

    return Number(rows[0]?.total ?? 0);
  }

  async getStatsByGoto(goto: string): Promise<AliasStats> {
    if (!goto || typeof goto !== "string") throw new Error("invalid_goto");
    const normalizedGoto = goto.trim().toLowerCase();

    const totalsRows = await this.database.query<TotalsRow[]>(
      `SELECT
          COUNT(*) AS totals,
          SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN created >= NOW() - INTERVAL 7 DAY THEN 1 ELSE 0 END) AS created_last_7d,
          SUM(CASE WHEN modified >= NOW() - INTERVAL 24 HOUR THEN 1 ELSE 0 END) AS modified_last_24h
       FROM alias
       WHERE goto = ?`,
      [normalizedGoto],
    );

    const domainsRows = await this.database.query<DomainStatsRow[]>(
      `SELECT
          SUBSTRING_INDEX(address, '@', -1) AS domain,
          COUNT(*) AS total,
          SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active
       FROM alias
       WHERE goto = ?
       GROUP BY domain
       ORDER BY total DESC, domain ASC`,
      [normalizedGoto],
    );

    const totals = totalsRows[0] ?? ({} as TotalsRow);

    return {
      totals: Number(totals.totals ?? 0),
      active: Number(totals.active ?? 0),
      created_last_7d: Number(totals.created_last_7d ?? 0),
      modified_last_24h: Number(totals.modified_last_24h ?? 0),
      by_domain: domainsRows.map((row) => ({
        domain: String(row.domain || ""),
        total: Number(row.total ?? 0),
        active: Number(row.active ?? 0),
      })),
    };
  }

  async existsByAddress(address: string, connection?: PoolConnection): Promise<boolean> {
    const executor = connection ?? this.database;
    const rows = await runQuery<ExistsRow[]>(
      executor,
      `SELECT 1 AS ok FROM alias WHERE address = ? LIMIT 1`,
      [address],
    );

    return rows.length === 1;
  }

  async getByAddress(
    address: string,
    connection?: PoolConnection,
    options: { forUpdate?: boolean } = {},
  ): Promise<AliasRow | null> {
    const executor = connection ?? this.database;
    const lockClause = options.forUpdate ? " FOR UPDATE" : "";
    const rows = await runQuery<AliasRow[]>(
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

  async existsReservedHandle(handle: string, connection?: PoolConnection): Promise<boolean> {
    const normalized = String(handle || "").trim().toLowerCase();
    if (!normalized) return false;

    const executor = connection ?? this.database;
    const rows = await runQuery<ExistsRow[]>(
      executor,
      `SELECT 1 AS ok
       FROM alias_handle
       WHERE handle = ?
       LIMIT 1`,
      [normalized],
    );

    return rows.length === 1;
  }

  async existsByLocalPart(localPart: string, connection?: PoolConnection): Promise<boolean> {
    const normalized = String(localPart || "").trim().toLowerCase();
    if (!normalized) return false;

    const executor = connection ?? this.database;
    const rows = await runQuery<ExistsRow[]>(
      executor,
      `SELECT 1 AS ok
       FROM alias
       WHERE SUBSTRING_INDEX(address, '@', 1) = ?
         AND active = 1
       LIMIT 1`,
      [normalized],
    );

    return rows.length === 1;
  }

  async createIfNotExists(payload: {
    address: string;
    goto: string;
    domainId?: number;
    active: number;
  }, connection?: PoolConnection): Promise<{
    ok: boolean;
    created: boolean;
    alreadyExists?: boolean;
    row?: AliasRow;
    insertId?: number | null;
  }> {
    if (payload.domainId !== undefined && payload.domainId !== null) {
      if (!Number.isInteger(payload.domainId) || payload.domainId <= 0) {
        throw new Error("invalid_domain_id");
      }
    }

    if (connection) {
      return this.createIfNotExistsWithConnection(connection, payload);
    }

    return this.database.withTransaction((conn: PoolConnection) =>
      this.createIfNotExistsWithConnection(conn, payload),
    );
  }

  async deactivateByAddress(
    address: string,
    connection?: PoolConnection,
  ): Promise<{ ok: boolean; deactivated: boolean; affectedRows: number }> {
    if (connection) {
      return this.deactivateByAddressWithConnection(connection, address);
    }

    return this.database.withTransaction((conn: PoolConnection) =>
      this.deactivateByAddressWithConnection(conn, address),
    );
  }

  private async createIfNotExistsWithConnection(
    connection: PoolConnection,
    payload: {
      address: string;
      goto: string;
      domainId?: number;
      active: number;
    },
  ): Promise<{
    ok: boolean;
    created: boolean;
    alreadyExists?: boolean;
    row?: AliasRow;
    insertId?: number | null;
  }> {
    const rows = await runQuery<AliasRow[]>(
      connection,
      `SELECT a.id, a.address, a.goto, a.active, d.id AS domain_id
       FROM alias a
       LEFT JOIN domain d
         ON d.name = SUBSTRING_INDEX(a.address, '@', -1)
       WHERE a.address = ?
       FOR UPDATE`,
      [payload.address],
    );

    if (rows.length === 1 && rows[0]) {
      return { ok: false, created: false, alreadyExists: true, row: rows[0] };
    }

    const act = payload.active ? 1 : 0;

    const result = await runQuery<InsertResult>(
      connection,
      `INSERT INTO alias (address, goto, active, created, modified)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
      [payload.address, payload.goto, act],
    );

    return {
      ok: true,
      created: true,
      insertId: result?.insertId != null ? Number(result.insertId) : null,
    };
  }

  private async deactivateByAddressWithConnection(
    connection: PoolConnection,
    address: string,
  ): Promise<{ ok: boolean; deactivated: boolean; affectedRows: number }> {
    const result = await runQuery<InsertResult>(
      connection,
      `UPDATE alias
       SET goto = ?,
           active = 0,
           modified = CURRENT_TIMESTAMP()
       WHERE address = ?
         AND active = 1
       LIMIT 1`,
      [PERMANENT_ALIAS_GOTO, address],
    );

    const affected = Number(result?.affectedRows ?? 0);
    return { ok: true, deactivated: affected === 1, affectedRows: affected };
  }
}
