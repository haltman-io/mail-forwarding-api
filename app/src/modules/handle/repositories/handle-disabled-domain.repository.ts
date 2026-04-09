import { Injectable } from "@nestjs/common";
import type { PoolConnection } from "mariadb";

import { DatabaseService } from "../../../shared/database/database.service.js";

export interface DisabledDomainRow {
  id: number;
  handle_id: number;
  domain: string;
  active: number;
  modified_at: Date | string;
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
export class HandleDisabledDomainRepository {
  constructor(private readonly database: DatabaseService) {}

  async disableDomain(
    handleId: number,
    domain: string,
    connection?: PoolConnection,
  ): Promise<{ ok: boolean }> {
    const executor = connection ?? this.database;
    const result = await runQuery<InsertResult>(
      executor,
      `INSERT INTO alias_handle_disabled_domain (handle_id, domain, active)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE
         active = 1,
         modified_at = CURRENT_TIMESTAMP(6)`,
      [handleId, domain],
    );

    return { ok: (result?.affectedRows ?? 0) >= 1 };
  }

  async enableDomain(
    handleId: number,
    domain: string,
    connection?: PoolConnection,
  ): Promise<{ ok: boolean; affected: number }> {
    const executor = connection ?? this.database;
    const result = await runQuery<InsertResult>(
      executor,
      `UPDATE alias_handle_disabled_domain
       SET active = 0,
           modified_at = CURRENT_TIMESTAMP(6)
       WHERE handle_id = ?
         AND domain = ?
         AND active = 1
       LIMIT 1`,
      [handleId, domain],
    );

    return {
      ok: Boolean(result?.affectedRows === 1),
      affected: Number(result?.affectedRows ?? 0),
    };
  }

  async getByHandleAndDomain(
    handleId: number,
    domain: string,
    connection?: PoolConnection,
    options: { forUpdate?: boolean } = {},
  ): Promise<DisabledDomainRow | null> {
    const executor = connection ?? this.database;
    const lockClause = options.forUpdate ? " FOR UPDATE" : "";
    const rows = await runQuery<DisabledDomainRow[]>(
      executor,
      `SELECT id, handle_id, domain, active, modified_at
       FROM alias_handle_disabled_domain
       WHERE handle_id = ?
         AND domain = ?
       LIMIT 1${lockClause}`,
      [handleId, domain],
    );

    return rows[0] ?? null;
  }

  async listActiveByHandleId(
    handleId: number,
    connection?: PoolConnection,
  ): Promise<DisabledDomainRow[]> {
    const executor = connection ?? this.database;
    return runQuery<DisabledDomainRow[]>(
      executor,
      `SELECT id, handle_id, domain, active, modified_at
       FROM alias_handle_disabled_domain
       WHERE handle_id = ?
         AND active = 1
       ORDER BY domain ASC`,
      [handleId],
    );
  }
}
