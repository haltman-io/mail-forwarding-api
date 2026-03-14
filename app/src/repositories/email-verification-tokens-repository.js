"use strict";

/**
 * @fileoverview Email verification token repository.
 */

const { query, withTx } = require("./db");
const {
  createOpaqueToken,
  sha256Buffer,
} = require("../lib/auth-secrets");

const DEFAULT_RETRY_MAX = 2;
const RETRY_MIN_DELAY_MS = 25;
const RETRY_MAX_DELAY_MS = 120;
const TOKENS_TABLE = "email_verification_tokens";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableTxError(err) {
  if (!err) return false;
  const code = String(err.code || "");
  const errno = Number(err.errno);
  return (
    code === "ER_LOCK_DEADLOCK" ||
    code === "ER_LOCK_WAIT_TIMEOUT" ||
    errno === 1213 ||
    errno === 1205
  );
}

function randomIntBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function assertUserId(value) {
  const userId = Number(value);
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("invalid_user_id");
  return userId;
}

function assertTokenHash32(buf) {
  if (!Buffer.isBuffer(buf) || buf.length !== 32) throw new Error("invalid_token_hash");
}

function assertTtlMinutes(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0 || num > 24 * 60) throw new Error("invalid_ttl_minutes");
  return Math.floor(num);
}

function normalizeCooldownSeconds(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.floor(num);
}

function normalizeMaxSendCount(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0 || num > 20) return 3;
  return Math.floor(num);
}

function buildPendingMeta(pending, cooldownSeconds, maxSendCount) {
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

async function withTxRetry(fn, opts = {}) {
  const maxRetries = Number.isFinite(opts.maxRetries) ? opts.maxRetries : DEFAULT_RETRY_MAX;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await withTx(fn);
    } catch (err) {
      if (!isRetryableTxError(err) || attempt >= maxRetries) {
        if (isRetryableTxError(err)) {
          const out = new Error("tx_busy");
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

async function selectPendingForUpdate(conn, userId) {
  const rows = await conn.query(
    `SELECT id, user_id, token_hash, expires_at, used_at, created_at, request_ip, user_agent, send_count, last_sent_at
     FROM ${TOKENS_TABLE}
     WHERE user_id = ?
       AND used_at IS NULL
     ORDER BY id DESC
     LIMIT 1
     FOR UPDATE`,
    [userId]
  );
  return rows[0] || null;
}

async function selectById(conn, id) {
  const rows = await conn.query(
    `SELECT id, user_id, token_hash, expires_at, used_at, created_at, request_ip, user_agent, send_count, last_sent_at
     FROM ${TOKENS_TABLE}
     WHERE id = ?
     LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

const emailVerificationTokensRepository = {
  /**
   * @param {{ userId: number, ttlMinutes: number, cooldownSeconds: number, maxSendCount: number, requestIpPacked?: Buffer | null, userAgentOrNull?: string | null }} payload
   * @returns {Promise<object>}
   */
  async upsertPendingByUserIdTx({
    userId,
    ttlMinutes,
    cooldownSeconds,
    maxSendCount,
    requestIpPacked,
    userAgentOrNull,
  }) {
    const normalizedUserId = assertUserId(userId);
    const ttl = assertTtlMinutes(ttlMinutes);
    const cooldown = normalizeCooldownSeconds(cooldownSeconds);
    const maxSends = normalizeMaxSendCount(maxSendCount);

    return withTxRetry(async (conn) => {
      const userRows = await conn.query(
        `SELECT id, email_verified_at
         FROM users
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [normalizedUserId]
      );
      const user = userRows[0] || null;
      if (!user || user.email_verified_at) {
        return { action: "not_needed", pending: null };
      }

      await conn.query(
        `UPDATE ${TOKENS_TABLE}
         SET used_at = NOW(6)
         WHERE user_id = ?
           AND used_at IS NULL
           AND expires_at <= NOW(6)`,
        [normalizedUserId]
      );

      let pending = await selectPendingForUpdate(conn, normalizedUserId);
      if (pending && pending.expires_at && new Date(pending.expires_at).getTime() <= Date.now()) {
        await conn.query(
          `UPDATE ${TOKENS_TABLE}
           SET used_at = NOW(6)
           WHERE id = ?
             AND used_at IS NULL`,
          [pending.id]
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
          return { action: "cooldown", pending: buildPendingMeta(pending, cooldown, maxSends) };
        }

        if (sendCount >= maxSends) {
          return { action: "rate_limited", pending: buildPendingMeta(pending, cooldown, maxSends) };
        }

        for (let attempt = 0; attempt < 3; attempt += 1) {
          const tokenPlain = createOpaqueToken();
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
                requestIpPacked || null,
                userAgentOrNull || null,
                pending.id,
              ]
            );

            const refreshed = (await selectById(conn, pending.id)) || pending;
            return {
              action: "resent",
              token_plain: tokenPlain,
              pending: buildPendingMeta(refreshed, cooldown, maxSends),
            };
          } catch (err) {
            if (err && err.code === "ER_DUP_ENTRY" && attempt < 2) continue;
            throw err;
          }
        }
      }

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const tokenPlain = createOpaqueToken();
        const tokenHash32 = sha256Buffer(tokenPlain);

        try {
          const result = await conn.query(
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
              requestIpPacked || null,
              userAgentOrNull || null,
            ]
          );

          const inserted = await selectById(conn, result.insertId);
          return {
            action: "created",
            token_plain: tokenPlain,
            pending: buildPendingMeta(inserted || {}, cooldown, maxSends),
          };
        } catch (err) {
          if (err && err.code === "ER_DUP_ENTRY" && attempt < 2) continue;
          throw err;
        }
      }

      throw new Error("token_insert_failed");
    });
  },

  /**
   * @param {Buffer} tokenHash32
   * @returns {Promise<object | null>}
   */
  async getPendingByTokenHash(tokenHash32) {
    assertTokenHash32(tokenHash32);

    const rows = await query(
      `SELECT id, user_id, expires_at, used_at, created_at, send_count, last_sent_at
       FROM ${TOKENS_TABLE}
       WHERE token_hash = ?
         AND used_at IS NULL
         AND expires_at > NOW(6)
       ORDER BY id DESC
       LIMIT 1`,
      [tokenHash32]
    );

    return rows[0] || null;
  },

  /**
   * @param {{ tokenHash32: Buffer }} payload
   * @returns {Promise<{ ok: boolean, reason?: string, user?: object }>}
   */
  async consumePendingTokenTx({ tokenHash32 }) {
    assertTokenHash32(tokenHash32);

    return withTxRetry(async (conn) => {
      const tokenRows = await conn.query(
        `SELECT id, user_id, expires_at, used_at
         FROM ${TOKENS_TABLE}
         WHERE token_hash = ?
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`,
        [tokenHash32]
      );
      const tokenRow = tokenRows[0] || null;
      if (!tokenRow) return { ok: false, reason: "invalid_or_expired" };
      if (tokenRow.used_at || new Date(tokenRow.expires_at).getTime() <= Date.now()) {
        return { ok: false, reason: "invalid_or_expired" };
      }

      const userRows = await conn.query(
        `SELECT id, username, email, email_verified_at, is_active
         FROM users
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [tokenRow.user_id]
      );
      const user = userRows[0] || null;
      if (!user || Number(user.is_active || 0) !== 1 || user.email_verified_at) {
        await conn.query(
          `UPDATE ${TOKENS_TABLE}
           SET used_at = NOW(6)
           WHERE user_id = ?
             AND used_at IS NULL`,
          [tokenRow.user_id]
        );
        return { ok: false, reason: "invalid_or_expired" };
      }

      await conn.query(
        `UPDATE users
         SET email_verified_at = NOW(6),
             updated_at = NOW(6)
         WHERE id = ?
           AND email_verified_at IS NULL
         LIMIT 1`,
        [user.id]
      );

      await conn.query(
        `UPDATE ${TOKENS_TABLE}
         SET used_at = NOW(6)
         WHERE user_id = ?
           AND used_at IS NULL`,
        [user.id]
      );

      return {
        ok: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
        },
      };
    });
  },
};

module.exports = {
  emailVerificationTokensRepository,
  sha256Buffer,
};
