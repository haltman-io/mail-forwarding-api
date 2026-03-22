import { Injectable } from "@nestjs/common";
import type { PoolConnection } from "mariadb";

import { DatabaseService } from "../../../shared/database/database.service.js";
import {
  generateConfirmationCode,
} from "../../../shared/utils/confirmation-code.js";
import { sha256Buffer } from "../../../shared/utils/crypto.js";

const DEFAULT_RETRY_MAX = 2;
const RETRY_MIN_DELAY_MS = 25;
const RETRY_MAX_DELAY_MS = 120;

export interface PendingMeta {
  id: number | null;
  email: string | null;
  expires_at: Date | null;
  last_sent_at: Date | null;
  send_count: number;
  next_allowed_send_at: Date | null;
  remaining_attempts: number;
}

export interface UpsertResult {
  action: "created" | "resent" | "cooldown" | "rate_limited";
  token_plain?: string;
  pending: PendingMeta;
}

interface PendingRow {
  id: number;
  email: string;
  status: string;
  days: number;
  created_at: Date | string;
  expires_at: Date | string;
  confirmed_at: Date | string | null;
  send_count: number | string;
  last_sent_at: Date | string | null;
  attempts_confirm: number;
}

interface InsertResult {
  affectedRows: number;
  insertId: number | bigint;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableTxError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; errno?: number };
  const code = String(e.code || "");
  const errno = Number(e.errno);
  return (
    code === "ER_LOCK_DEADLOCK" ||
    code === "ER_LOCK_WAIT_TIMEOUT" ||
    errno === 1213 ||
    errno === 1205
  );
}

function randomIntBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function assertTtlMinutes(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0 || num > 60) throw new Error("invalid_ttl_minutes");
  return Math.floor(num);
}

function normalizeCooldownSeconds(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.floor(num);
}

function normalizeMaxSendCount(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0 || num > 20) return 3;
  return Math.floor(num);
}

function buildPendingMeta(
  pending: PendingRow | null,
  cooldownSeconds: number,
  maxSendCount: number,
): PendingMeta {
  const lastSentAt = pending?.last_sent_at ? new Date(pending.last_sent_at) : null;
  const expiresAt = pending?.expires_at ? new Date(pending.expires_at) : null;
  const sendCount = Number(pending?.send_count ?? 0);
  const nextAllowedSendAt =
    lastSentAt && cooldownSeconds > 0
      ? new Date(lastSentAt.getTime() + cooldownSeconds * 1000)
      : null;
  const remainingAttempts = Math.max(0, maxSendCount - sendCount);

  return {
    id: pending?.id ?? null,
    email: pending?.email ?? null,
    expires_at: expiresAt,
    last_sent_at: lastSentAt,
    send_count: sendCount,
    next_allowed_send_at: nextAllowedSendAt,
    remaining_attempts: remainingAttempts,
  };
}

async function selectPendingForUpdate(
  conn: PoolConnection,
  email: string,
): Promise<PendingRow | null> {
  const rows: PendingRow[] = await conn.query(
    `SELECT id, email, status, days, created_at, expires_at, confirmed_at,
            send_count, last_sent_at, attempts_confirm
     FROM api_token_requests
     WHERE email = ?
       AND status = 'pending'
     ORDER BY id DESC
     LIMIT 1
     FOR UPDATE`,
    [email],
  );
  return rows[0] ?? null;
}

async function selectById(conn: PoolConnection, id: number): Promise<PendingRow | null> {
  const rows: PendingRow[] = await conn.query(
    `SELECT id, email, status, days, created_at, expires_at, confirmed_at,
            send_count, last_sent_at, attempts_confirm
     FROM api_token_requests
     WHERE id = ?
     LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

@Injectable()
export class ApiTokenRequestsRepository {
  constructor(private readonly database: DatabaseService) {}

  async getPendingByTokenHash(
    tokenHash32: Buffer,
    connection?: PoolConnection,
    options: { forUpdate?: boolean } = {},
  ): Promise<PendingRow | null> {
    if (!Buffer.isBuffer(tokenHash32) || tokenHash32.length !== 32) {
      throw new Error("invalid_token_hash");
    }

    const executor = connection ?? this.database;
    const lockClause = options.forUpdate ? " FOR UPDATE" : "";
    const rows = await runQuery<PendingRow[]>(
      executor,
      `SELECT id, email, status, days, created_at, expires_at, confirmed_at,
              send_count, last_sent_at, attempts_confirm
       FROM api_token_requests
       WHERE token_hash = ?
         AND status = 'pending'
         AND expires_at > NOW(6)
       ORDER BY id DESC
       LIMIT 1${lockClause}`,
      [tokenHash32],
    );

    return rows[0] ?? null;
  }

  async markConfirmedById(id: number, connection?: PoolConnection): Promise<boolean> {
    const executor = connection ?? this.database;
    const result = await runQuery<InsertResult>(
      executor,
      `UPDATE api_token_requests
       SET status = 'confirmed',
           confirmed_at = NOW(6)
       WHERE id = ?
         AND status = 'pending'
         AND expires_at > NOW(6)`,
      [id],
    );

    return Boolean(result && result.affectedRows === 1);
  }

  async upsertPendingByEmailTx(payload: {
    email: string;
    days: number;
    ttlMinutes: number;
    cooldownSeconds: number;
    maxSendCount: number;
    requestIpPacked: Buffer | null;
    userAgentOrNull: string | null;
  }): Promise<UpsertResult> {
    const ttl = assertTtlMinutes(payload.ttlMinutes);
    const cooldown = normalizeCooldownSeconds(payload.cooldownSeconds);
    const maxSends = normalizeMaxSendCount(payload.maxSendCount);

    const maxRetries = DEFAULT_RETRY_MAX;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await this.database.withTransaction(async (conn: PoolConnection) => {
          await conn.query(
            `UPDATE api_token_requests
             SET status = 'expired'
             WHERE email = ?
               AND status = 'pending'
               AND expires_at <= NOW(6)`,
            [payload.email],
          );

          let pending = await selectPendingForUpdate(conn, payload.email);

          if (
            pending &&
            pending.expires_at &&
            new Date(pending.expires_at).getTime() <= Date.now()
          ) {
            await conn.query(
              `UPDATE api_token_requests
               SET status = 'expired'
               WHERE id = ?
                 AND status = 'pending'`,
              [pending.id],
            );
            pending = null;
          }

          if (pending) {
            const lastSentAt = pending.last_sent_at
              ? new Date(pending.last_sent_at)
              : null;
            const sendCount = Number(pending.send_count ?? 0);
            const nextAllowedSendAt =
              lastSentAt && cooldown > 0
                ? new Date(lastSentAt.getTime() + cooldown * 1000)
                : null;
            const nowMs = Date.now();

            if (nextAllowedSendAt && nextAllowedSendAt.getTime() > nowMs) {
              return {
                action: "cooldown" as const,
                pending: buildPendingMeta(pending, cooldown, maxSends),
              };
            }

            if (sendCount >= maxSends) {
              return {
                action: "rate_limited" as const,
                pending: buildPendingMeta(pending, cooldown, maxSends),
              };
            }

            for (let dup = 0; dup < 3; dup += 1) {
              const tokenPlain = generateConfirmationCode();
              const tokenHash32 = sha256Buffer(tokenPlain);
              try {
                await conn.query(
                  `UPDATE api_token_requests
                   SET token_hash = ?,
                       days = ?,
                       expires_at = DATE_ADD(NOW(6), INTERVAL ? MINUTE),
                       request_ip = ?,
                       user_agent = ?,
                       send_count = send_count + 1,
                       last_sent_at = NOW(6)
                   WHERE id = ?`,
                  [
                    tokenHash32,
                    payload.days,
                    ttl,
                    payload.requestIpPacked,
                    payload.userAgentOrNull ?? null,
                    pending.id,
                  ],
                );

                const refreshed = (await selectById(conn, pending.id)) ?? pending;
                return {
                  action: "resent" as const,
                  token_plain: tokenPlain,
                  pending: buildPendingMeta(refreshed, cooldown, maxSends),
                };
              } catch (err) {
                const e = err as { code?: string };
                if (e?.code === "ER_DUP_ENTRY" && dup < 2) {
                  continue;
                }
                throw err;
              }
            }
          }

          for (let dup = 0; dup < 3; dup += 1) {
            const tokenPlain = generateConfirmationCode();
            const tokenHash32 = sha256Buffer(tokenPlain);

            try {
              const result: InsertResult = await conn.query(
                `INSERT INTO api_token_requests (
                  email, token_hash, status, days, created_at, expires_at,
                  request_ip, user_agent, send_count, last_sent_at, attempts_confirm
                ) VALUES (
                  ?, ?, 'pending', ?, NOW(6), DATE_ADD(NOW(6), INTERVAL ? MINUTE),
                  ?, ?, 1, NOW(6), 0
                )`,
                [
                  payload.email,
                  tokenHash32,
                  payload.days,
                  ttl,
                  payload.requestIpPacked,
                  payload.userAgentOrNull ?? null,
                ],
              );

              const inserted = await selectById(conn, Number(result.insertId));
              return {
                action: "created" as const,
                token_plain: tokenPlain,
                pending: buildPendingMeta(inserted, cooldown, maxSends),
              };
            } catch (err) {
              const e = err as { code?: string };
              if (e?.code === "ER_DUP_ENTRY") {
                const existing = await selectPendingForUpdate(conn, payload.email);
                if (existing) {
                  return {
                    action: "cooldown" as const,
                    pending: buildPendingMeta(existing, cooldown, maxSends),
                  };
                }
                if (dup < 2) continue;
              }
              throw err;
            }
          }

          throw new Error("tx_retry_exhausted");
        });
      } catch (err) {
        if (!isRetryableTxError(err) || attempt >= maxRetries) {
          if (isRetryableTxError(err)) {
            const out = new Error("tx_busy") as Error & { code: string; cause: unknown };
            out.code = "tx_busy";
            out.cause = err;
            throw out;
          }
          throw err;
        }
        const delayMs = randomIntBetween(RETRY_MIN_DELAY_MS, RETRY_MAX_DELAY_MS);
        await sleep(delayMs);
      }
    }

    throw new Error("tx_retry_exhausted");
  }
}
