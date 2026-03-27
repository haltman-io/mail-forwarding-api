import type { PoolConnection } from "mariadb";

import { DatabaseService } from "../../shared/database/database.service.js";

const DEFAULT_RETRY_MAX = 2;
const RETRY_MIN_DELAY_MS = 25;
const RETRY_MAX_DELAY_MS = 120;

export interface InsertResult {
  affectedRows: number;
  insertId: number | bigint | null;
}

export interface CountRow {
  total: number | string | bigint | null;
}

export interface ExistsRow {
  ok: number;
}

type QueryExecutor = DatabaseService | PoolConnection;

export function runQuery<T>(
  executor: QueryExecutor,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T> {
  return (
    executor as {
      query: (statement: string, values?: readonly unknown[]) => Promise<T>;
    }
  ).query(sql, [...params]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomIntBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isRetryableTxError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const error = err as { code?: string; errno?: number };
  const code = String(error.code || "");
  const errno = Number(error.errno);
  return (
    code === "ER_LOCK_DEADLOCK" ||
    code === "ER_LOCK_WAIT_TIMEOUT" ||
    errno === 1213 ||
    errno === 1205
  );
}

export async function withTxRetry<T>(
  database: DatabaseService,
  work: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt <= DEFAULT_RETRY_MAX; attempt += 1) {
    try {
      return await database.withTransaction(work);
    } catch (error) {
      if (!isRetryableTxError(error) || attempt >= DEFAULT_RETRY_MAX) {
        if (isRetryableTxError(error)) {
          const out = new Error("tx_busy") as Error & {
            code: string;
            cause: unknown;
          };
          out.code = "tx_busy";
          out.cause = error;
          throw out;
        }

        throw error;
      }

      await sleep(randomIntBetween(RETRY_MIN_DELAY_MS, RETRY_MAX_DELAY_MS));
    }
  }

  throw new Error("tx_retry_exhausted");
}
