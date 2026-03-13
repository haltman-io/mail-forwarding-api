"use strict";

/**
 * @fileoverview Password reset request repository (SQL access).
 */

const crypto = require("crypto");
const { query, withTx } = require("./db");
const { generateConfirmationCode } = require("../lib/confirmation-code");

const DEFAULT_RETRY_MAX = 2;
const RETRY_MIN_DELAY_MS = 25;
const RETRY_MAX_DELAY_MS = 120;

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

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest();
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
  if (!Number.isFinite(num) || num <= 0 || num > 60) throw new Error("invalid_ttl_minutes");
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
    email: pending?.email ?? null,
    expires_at: expiresAt,
    last_sent_at: lastSentAt,
    send_count: sendCount,
    next_allowed_send_at: nextAllowedSendAt,
    remaining_attempts: remainingAttempts,
  };
}

async function selectPendingForUpdate(conn, userId) {
  const rows = await conn.query(
    `SELECT id, user_id, email, status, created_at, expires_at, consumed_at,
            send_count, last_sent_at, attempts_confirm
     FROM password_reset_requests
     WHERE user_id = ?
       AND status = 'pending'
     ORDER BY id DESC
     LIMIT 1
     FOR UPDATE`,
    [userId]
  );
  return rows[0] || null;
}

async function selectById(conn, id) {
  const rows = await conn.query(
    `SELECT id, user_id, email, status, created_at, expires_at, consumed_at,
            send_count, last_sent_at, attempts_confirm
     FROM password_reset_requests
     WHERE id = ?
     LIMIT 1`,
    [id]
  );
  return rows[0] || null;
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

const passwordResetRequestsRepository = {
  /**
   * @param {Buffer} tokenHash32
   * @returns {Promise<object | null>}
   */
  async getPendingByTokenHash(tokenHash32) {
    assertTokenHash32(tokenHash32);

    const rows = await query(
      `SELECT id, user_id, email, status, created_at, expires_at, consumed_at,
              send_count, last_sent_at, attempts_confirm
       FROM password_reset_requests
       WHERE token_hash = ?
         AND status = 'pending'
         AND expires_at > NOW(6)
       ORDER BY id DESC
       LIMIT 1`,
      [tokenHash32]
    );

    return rows[0] || null;
  },

  /**
   * Create or rotate a pending password reset request in a single transaction.
   * @param {object} payload
   * @returns {Promise<object>}
   */
  async upsertPendingByUserIdTx({
    userId,
    email,
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
      await conn.query(
        `UPDATE password_reset_requests
         SET status = 'expired'
         WHERE user_id = ?
           AND status = 'pending'
           AND expires_at <= NOW(6)`,
        [normalizedUserId]
      );

      let pending = await selectPendingForUpdate(conn, normalizedUserId);

      if (pending && pending.expires_at && new Date(pending.expires_at).getTime() <= Date.now()) {
        await conn.query(
          `UPDATE password_reset_requests
           SET status = 'expired'
           WHERE id = ?
             AND status = 'pending'`,
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
          const tokenHash32 = sha256Buffer(tokenPlain);
          try {
            await conn.query(
              `UPDATE password_reset_requests
               SET token_hash = ?,
                   email = ?,
                   expires_at = DATE_ADD(NOW(6), INTERVAL ? MINUTE),
                   request_ip = ?,
                   user_agent = ?,
                   send_count = send_count + 1,
                   last_sent_at = NOW(6)
               WHERE id = ?`,
              [
                tokenHash32,
                email,
                ttl,
                requestIpPacked,
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
        const tokenPlain = generateConfirmationCode();
        const tokenHash32 = sha256Buffer(tokenPlain);

        try {
          const result = await conn.query(
            `INSERT INTO password_reset_requests (
              user_id, email, token_hash, status, created_at, expires_at,
              request_ip, user_agent, send_count, last_sent_at, attempts_confirm
            ) VALUES (
              ?, ?, ?, 'pending', NOW(6), DATE_ADD(NOW(6), INTERVAL ? MINUTE),
              ?, ?, 1, NOW(6), 0
            )`,
            [
              normalizedUserId,
              email,
              tokenHash32,
              ttl,
              requestIpPacked,
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
          if (err && err.code === "ER_DUP_ENTRY") {
            const existing = await selectPendingForUpdate(conn, normalizedUserId);
            if (existing) {
              return {
                action: "cooldown",
                pending: buildPendingMeta(existing, cooldown, maxSends),
              };
            }
            if (attempt < 2) continue;
          }
          throw err;
        }
      }
    });
  },

  /**
   * Consume a pending token, update password and revoke sessions in one transaction.
   * @param {object} payload
   * @returns {Promise<{ ok: boolean, reason?: string, user?: object, sessionsRevoked?: number }>}
   */
  async consumePendingAndResetPasswordTx({ tokenHash32, passwordHash }) {
    assertTokenHash32(tokenHash32);

    return withTxRetry(async (conn) => {
      const pendingRows = await conn.query(
        `SELECT id, user_id, email, status, created_at, expires_at, consumed_at
         FROM password_reset_requests
         WHERE token_hash = ?
           AND status = 'pending'
           AND expires_at > NOW(6)
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`,
        [tokenHash32]
      );

      const pending = pendingRows[0] || null;
      if (!pending) return { ok: false, reason: "invalid_or_expired" };

      const userRows = await conn.query(
        `SELECT id, email, is_active
         FROM users
         WHERE id = ?
         LIMIT 1
         FOR UPDATE`,
        [pending.user_id]
      );

      const user = userRows[0] || null;
      if (!user || Number(user.is_active || 0) !== 1) {
        await conn.query(
          `UPDATE password_reset_requests
           SET status = 'expired'
           WHERE id = ?
             AND status = 'pending'`,
          [pending.id]
        );
        return { ok: false, reason: "invalid_or_expired" };
      }

      await conn.query(
        `UPDATE users
         SET password_hash = ?,
             updated_at = NOW(6)
         WHERE id = ?
         LIMIT 1`,
        [passwordHash, user.id]
      );

      const revokeResult = await conn.query(
        `UPDATE auth_sessions
         SET status = 'revoked',
             revoked_at = NOW(6)
         WHERE user_id = ?
           AND status = 'active'
           AND revoked_at IS NULL`,
        [user.id]
      );

      const consumeResult = await conn.query(
        `UPDATE password_reset_requests
         SET status = 'consumed',
             consumed_at = NOW(6)
         WHERE id = ?
           AND status = 'pending'
           AND expires_at > NOW(6)`,
        [pending.id]
      );

      if (!consumeResult || consumeResult.affectedRows !== 1) {
        return { ok: false, reason: "invalid_or_expired" };
      }

      await conn.query(
        `UPDATE password_reset_requests
         SET status = 'expired'
         WHERE user_id = ?
           AND id <> ?
           AND status = 'pending'`,
        [user.id, pending.id]
      );

      return {
        ok: true,
        user: {
          id: user.id,
          email: String(user.email || "").trim().toLowerCase(),
        },
        sessionsRevoked: Number(revokeResult?.affectedRows ?? 0),
      };
    });
  },
};

module.exports = {
  passwordResetRequestsRepository,
  sha256Buffer,
};
