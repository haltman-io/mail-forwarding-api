import { Injectable } from "@nestjs/common";
import type { PoolConnection } from "mariadb";

import { DatabaseService } from "../../../shared/database/database.service.js";

export interface HandleRow {
  id: number;
  handle: string;
  address: string | null;
  active: number;
  pgp_public_key?: string | null;
  pgp_fingerprint?: string | null;
  pgp_enabled?: number | null;
  pgp_hide_subject?: number | null;
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
      `SELECT
         id,
         handle,
         address,
         active,
         pgp_public_key,
         pgp_fingerprint,
         pgp_enabled,
         pgp_hide_subject,
         unsubscribed_at
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
      `SELECT
         id,
         handle,
         address,
         active,
         pgp_public_key,
         pgp_fingerprint,
         pgp_enabled,
         pgp_hide_subject,
         unsubscribed_at
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
    options: { forUpdate?: boolean } = {},
  ): Promise<boolean> {
    const executor = connection ?? this.database;
    const lockClause = options.forUpdate ? " FOR UPDATE" : "";
    const rows = await runQuery<ExistsRow[]>(
      executor,
      `SELECT 1 AS ok
       FROM alias_handle
       WHERE handle = ?
       LIMIT 1${lockClause}`,
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
           pgp_public_key = NULL,
           pgp_fingerprint = NULL,
           pgp_enabled = 0,
           pgp_hide_subject = 0,
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

  async updatePgpById(
    id: number,
    payload: {
      publicKey: string | null;
      fingerprint: string | null;
      enabled: boolean;
      hideSubject: boolean;
    },
    connection?: PoolConnection,
  ): Promise<{ ok: boolean; affectedRows: number }> {
    const executor = connection ?? this.database;
    const result = await runQuery<InsertResult>(
      executor,
      `UPDATE alias_handle
       SET pgp_public_key = ?,
           pgp_fingerprint = ?,
           pgp_enabled = ?,
           pgp_hide_subject = ?
       WHERE id = ?
       LIMIT 1`,
      [
        payload.publicKey,
        payload.fingerprint,
        payload.enabled ? 1 : 0,
        payload.hideSubject ? 1 : 0,
        id,
      ],
    );

    return { ok: true, affectedRows: Number(result?.affectedRows ?? 0) };
  }

  async clearPgpById(
    id: number,
    connection?: PoolConnection,
  ): Promise<{ ok: boolean; affectedRows: number }> {
    return this.updatePgpById(
      id,
      {
        publicKey: null,
        fingerprint: null,
        enabled: false,
        hideSubject: false,
      },
      connection,
    );
  }
}
