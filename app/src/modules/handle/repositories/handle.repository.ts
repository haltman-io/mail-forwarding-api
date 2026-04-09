import { Injectable } from "@nestjs/common";
import type { PoolConnection } from "mariadb";

import { DatabaseService } from "../../../shared/database/database.service.js";

export interface HandleRow {
  id: number;
  handle: string;
  address: string | null;
  active: number;
  unsubscribed_at: Date | string | null;
}

interface ExistsRow {
  ok: number;
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
export class HandleRepository {
  constructor(private readonly database: DatabaseService) {}

  async getByHandle(
    handle: string,
    connection?: PoolConnection,
    options: { forUpdate?: boolean } = {},
  ): Promise<HandleRow | null> {
    const executor = connection ?? this.database;
    const lockClause = options.forUpdate ? " FOR UPDATE" : "";
    const rows = await runQuery<HandleRow[]>(
      executor,
      `SELECT id, handle, address, active, unsubscribed_at
       FROM alias_handle
       WHERE handle = ?
       LIMIT 1${lockClause}`,
      [handle],
    );

    return rows[0] ?? null;
  }

  async getActiveByHandle(
    handle: string,
    connection?: PoolConnection,
    options: { forUpdate?: boolean } = {},
  ): Promise<HandleRow | null> {
    const executor = connection ?? this.database;
    const lockClause = options.forUpdate ? " FOR UPDATE" : "";
    const rows = await runQuery<HandleRow[]>(
      executor,
      `SELECT id, handle, address, active, unsubscribed_at
       FROM alias_handle
       WHERE handle = ?
         AND active = 1
         AND address IS NOT NULL
       LIMIT 1${lockClause}`,
      [handle],
    );

    return rows[0] ?? null;
  }

  async existsByHandle(
    handle: string,
    connection?: PoolConnection,
  ): Promise<boolean> {
    const executor = connection ?? this.database;
    const rows = await runQuery<ExistsRow[]>(
      executor,
      `SELECT 1 AS ok
       FROM alias_handle
       WHERE handle = ?
       LIMIT 1`,
      [handle],
    );

    return rows.length === 1;
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

  async unsubscribe(
    handle: string,
    connection?: PoolConnection,
  ): Promise<{ ok: boolean; affected: number }> {
    const executor = connection ?? this.database;
    const result = await runQuery<InsertResult>(
      executor,
      `UPDATE alias_handle
       SET address = NULL,
           active = 0,
           unsubscribed_at = CURRENT_TIMESTAMP(6)
       WHERE handle = ?
         AND active = 1
       LIMIT 1`,
      [handle],
    );

    return {
      ok: Boolean(result?.affectedRows === 1),
      affected: Number(result?.affectedRows ?? 0),
    };
  }
}
