import { Injectable } from "@nestjs/common";
import type { PoolConnection } from "mariadb";

import { DatabaseService } from "../../../shared/database/database.service.js";
import { generateConfirmationCode } from "../../../shared/utils/confirmation-code.js";
import { sha256Buffer } from "../../../shared/utils/crypto.js";

const DEFAULT_RETRY_MAX = 2;
const RETRY_MIN_DELAY_MS = 25;
const RETRY_MAX_DELAY_MS = 120;
const TOKENS_TABLE = "password_reset_tokens";

interface InsertResult {
  affectedRows: number;
  insertId: number | bigint;
}

interface PendingRow {
  id: number;
  user_id: number;
  token_hash: Buffer;
  expires_at: Date | string;
  used_at: Date | string | null;
  created_at: Date | string;
  request_ip: Buffer | null;
  user_agent: string | null;
  send_count: number | string;
  last_sent_at: Date | string | null;
}

export interface PendingMeta {
  id: number | null;
  user_id: number | null;
  expires_at: Date | null;
  last_sent_at: Date | null;
  send_count: number;
  next_allowed_send_at: Date | null;
  remaining_attempts: number;
}

type UpsertResult =
  | { action: "cooldown" | "rate_limited"; pending: PendingMeta }
  | { action: "created" | "resent"; token_plain: string; pending: PendingMeta };

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

function assertUserId(value: unknown): number {
  const userId = Number(value);
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("invalid_user_id");
  return userId;
}

function assertTokenHash32(buf: Buffer): Buffer {
  if (!Buffer.isBuffer(buf) || buf.length !== 32) throw new Error("invalid_token_hash");
  return buf;
}

function assertTtlMinutes(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0 || num > 60) {
    throw new Error("invalid_ttl_minutes");
  }
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
    user_id: pending?.user_id ?? null,
    expires_at: expiresAt,
    last_sent_at: lastSentAt,
    send_count: sendCount,
    next_allowed_send_at: nextAllowedSendAt,
    remaining_attempts: remainingAttempts,
  };
}

async function withTxRetry<T>(
  database: DatabaseService,
  work: (connection: PoolConnection) => Promise<T>,
  opts: { maxRetries?: number } = {},
): Promise<T> {
  const maxRetries = Number.isFinite(opts.maxRetries)
    ? Number(opts.maxRetries)
    : DEFAULT_RETRY_MAX;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await database.withTransaction(work);
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
      await sleep(randomIntBetween(RETRY_MIN_DELAY_MS, RETRY_MAX_DELAY_MS));
    }
  }
  throw new Error("tx_retry_exhausted");
}

async function selectPendingForUpdate(
  conn: PoolConnection,
  userId: number,
): Promise<PendingRow | null> {
  const rows = await conn.query<PendingRow[]>(
    `SELECT id, user_id, token_hash, expires_at, used_at, created_at,
            request_ip, user_agent, send_count, last_sent_at
     FROM ${TOKENS_TABLE}
     WHERE user_id = ?
       AND used_at IS NULL
     ORDER BY id DESC
     LIMIT 1
     FOR UPDATE`,
    [userId],
  );
  return rows[0] ?? null;
}

async function selectById(conn: PoolConnection, id: number): Promise<PendingRow | null> {
  const rows = await conn.query<PendingRow[]>(
    `SELECT id, user_id, token_hash, expires_at, used_at, created_at,
            request_ip, user_agent, send_count, last_sent_at
     FROM ${TOKENS_TABLE}
     WHERE id = ?
     LIMIT 1`,
    [id],
  );
  return rows[0] ?? null;
}

@Injectable()
export class PasswordResetRequestsRepository {
  constructor(private readonly database: DatabaseService) {}

  async getPendingByTokenHash(
    tokenHash32: Buffer,
  ): Promise<{ id: number; user_id: number; expires_at: Date | string; used_at: Date | string | null; created_at: Date | string; send_count: number | string; last_sent_at: Date | string | null } | null> {
    assertTokenHash32(tokenHash32);

    const rows = await this.database.query<
      {
        id: number;
        user_id: number;
        expires_at: Date | string;
        used_at: Date | string | null;
        created_at: Date | string;
        send_count: number | string;
        last_sent_at: Date | string | null;
      }[]
    >(
      `SELECT id, user_id, expires_at, used_at, created_at, send_count, last_sent_at
       FROM ${TOKENS_TABLE}
       WHERE token_hash = ?
         AND used_at IS NULL
         AND expires_at > NOW(6)
       ORDER BY id DESC
       LIMIT 1`,
      [tokenHash32],
    );

    return rows[0] ?? null;
  }

  async upsertPendingByUserIdTx(payload: {
    userId: number;
    ttlMinutes: number;
    cooldownSeconds: number;
    maxSendCount: number;
    requestIpPacked?: Buffer | null;
    userAgentOrNull?: string | null;
  }): Promise<UpsertResult> {
    const normalizedUserId = assertUserId(payload.userId);
    const ttl = assertTtlMinutes(payload.ttlMinutes);
    const cooldown = normalizeCooldownSeconds(payload.cooldownSeconds);
    const maxSends = normalizeMaxSendCount(payload.maxSendCount);

    return withTxRetry(this.database, async (conn) => {
      await conn.query(
        `UPDATE ${TOKENS_TABLE}
         SET used_at = NOW(6)
         WHERE user_id = ?
           AND used_at IS NULL
           AND expires_at <= NOW(6)`,
        [normalizedUserId],
      );

      let pending = await selectPendingForUpdate(conn, normalizedUserId);
      if (pending && new Date(pending.expires_at).getTime() <= Date.now()) {
        await conn.query(
          `UPDATE ${TOKENS_TABLE}
           SET used_at = NOW(6)
           WHERE id = ?
             AND used_at IS NULL`,
          [pending.id],
        );
        pending = null;
      }

      if (pending) {
        const lastSentAt = pending.last_sent_at ? new Date(pending.last_sent_at) : null;
        const sendCount = Number(pending.send_count ?? 0);
        const nextAllowedSendAt =
          lastSentAt && cooldown > 0
            ? new Date(lastSentAt.getTime() + cooldown * 1000)
            : null;

        if (nextAllowedSendAt && nextAllowedSendAt.getTime() > Date.now()) {
          return {
            action: "cooldown",
            pending: buildPendingMeta(pending, cooldown, maxSends),
          };
        }

        if (sendCount >= maxSends) {
          return {
            action: "rate_limited",
            pending: buildPendingMeta(pending, cooldown, maxSends),
          };
        }

        for (let attempt = 0; attempt < 3; attempt += 1) {
          const tokenPlain = generateConfirmationCode();
          const nextTokenHash32 = sha256Buffer(tokenPlain);

          try {
            await conn.query(
              `UPDATE ${TOKENS_TABLE}
               SET token_hash = ?,
                   expires_at = DATE_ADD(NOW(6), INTERVAL ? MINUTE),
                   request_ip = ?,
                   user_agent = ?,
                   send_count = send_count + 1,
                   last_sent_at = NOW(6)
               WHERE id = ?`,
              [
                nextTokenHash32,
                ttl,
                payload.requestIpPacked || null,
                payload.userAgentOrNull || null,
                pending.id,
              ],
            );

            const refreshed = (await selectById(conn, pending.id)) ?? pending;
            return {
              action: "resent",
              token_plain: tokenPlain,
              pending: buildPendingMeta(refreshed, cooldown, maxSends),
            };
          } catch (err) {
            const e = err as { code?: string };
            if (e?.code === "ER_DUP_ENTRY" && attempt < 2) continue;
            throw err;
          }
        }
      }

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const tokenPlain = generateConfirmationCode();
        const tokenHash32 = sha256Buffer(tokenPlain);

        try {
          const result = await conn.query<InsertResult>(
            `INSERT INTO ${TOKENS_TABLE} (
              user_id,
              token_hash,
              expires_at,
              used_at,
              created_at,
              request_ip,
              user_agent,
              send_count,
              last_sent_at
            ) VALUES (
              ?, ?, DATE_ADD(NOW(6), INTERVAL ? MINUTE), NULL, NOW(6), ?, ?, 1, NOW(6)
            )`,
            [
              normalizedUserId,
              tokenHash32,
              ttl,
              payload.requestIpPacked || null,
              payload.userAgentOrNull || null,
            ],
          );

          const inserted = await selectById(conn, Number(result.insertId));
          return {
            action: "created",
            token_plain: tokenPlain,
            pending: buildPendingMeta(inserted, cooldown, maxSends),
          };
        } catch (err) {
          const e = err as { code?: string };
          if (e?.code === "ER_DUP_ENTRY" && attempt < 2) continue;
          throw err;
        }
      }

      throw new Error("token_insert_failed");
    });
  }

  async consumePendingAndResetPasswordTx(payload: {
    tokenHash32: Buffer;
    passwordHash: string;
  }): Promise<{ ok: boolean; reason?: string; user?: { id: number; username: string; email: string }; sessionsRevoked?: number }> {
    assertTokenHash32(payload.tokenHash32);
    const normalizedPasswordHash = String(payload.passwordHash || "").trim();
    if (!normalizedPasswordHash) throw new Error("invalid_password_hash");

    return withTxRetry(this.database, async (conn) => {
      const tokenRows = await conn.query<
        { id: number; user_id: number; expires_at: Date | string; used_at: Date | string | null }[]
      >(
        `SELECT id, user_id, expires_at, used_at
         FROM ${TOKENS_TABLE}
         WHERE token_hash = ?
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`,
        [payload.tokenHash32],
      );
      const tokenRow = tokenRows[0] ?? null;

      if (!tokenRow) return { ok: false, reason: "invalid_or_expired" };
      if (tokenRow.used_at || new Date(tokenRow.expires_at).getTime() <= Date.now()) {
        return { ok: false, reason: "invalid_or_expired" };
      }

      const userRows = await conn.query<
        { id: number; username: string; email: string; is_active: number }[]
      >(
        `SELECT id, username, email, is_active
         FROM users
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [tokenRow.user_id],
      );
      const user = userRows[0] ?? null;
      if (!user || Number(user.is_active || 0) !== 1) {
        await conn.query(
          `UPDATE ${TOKENS_TABLE}
           SET used_at = NOW(6)
           WHERE id = ?
             AND used_at IS NULL`,
          [tokenRow.id],
        );
        return { ok: false, reason: "invalid_or_expired" };
      }

      await conn.query(
        `UPDATE users
         SET password_hash = ?,
             password_changed_at = NOW(6),
             updated_at = NOW(6)
         WHERE id = ?
         LIMIT 1`,
        [normalizedPasswordHash, user.id],
      );

      const revokeResult = await conn.query<InsertResult>(
        `UPDATE auth_sessions
         SET status = 'revoked',
             revoked_at = COALESCE(revoked_at, NOW(6))
         WHERE user_id = ?
           AND status IN ('active', 'rotated')`,
        [user.id],
      );

      await conn.query(
        `UPDATE ${TOKENS_TABLE}
         SET used_at = NOW(6)
         WHERE user_id = ?
           AND used_at IS NULL`,
        [user.id],
      );

      return {
        ok: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
        },
        sessionsRevoked: Number(revokeResult?.affectedRows ?? 0),
      };
    });
  }
}
