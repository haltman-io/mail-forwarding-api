"use strict";

/**
 * @fileoverview API token request repository (SQL access).
 */

const crypto = require("crypto");
const { query, withTx } = require("./db");

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const MIN_TOKEN_LEN = 12;
const MAX_TOKEN_LEN = 64;
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

/**
 * Generate a Base62 token with unbiased entropy.
 * @param {number} len
 * @returns {string}
 */
function generateBase62Token(len = 20) {
  const size = Number(len);
  if (!Number.isFinite(size) || size < MIN_TOKEN_LEN || size > MAX_TOKEN_LEN) {
    throw new Error("invalid_token_length");
  }

  const out = [];
  while (out.length < size) {
    const buf = crypto.randomBytes(32);
    for (let i = 0; i < buf.length && out.length < size; i++) {
      const x = buf[i];
      if (x < 248) out.push(BASE62[x % 62]);
    }
  }
  return out.join("");
}

/**
 * @param {string} value
 * @returns {Buffer}
 */
function sha256Buffer(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest();
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

function normalizeTokenLength(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < MIN_TOKEN_LEN || num > MAX_TOKEN_LEN) {
    return 20;
  }
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
    email: pending?.email ?? null,
    expires_at: expiresAt,
    last_sent_at: lastSentAt,
    send_count: sendCount,
    next_allowed_send_at: nextAllowedSendAt,
    remaining_attempts: remainingAttempts,
  };
}

async function selectPendingForUpdate(conn, email) {
  const rows = await conn.query(
    `SELECT id, email, status, days, created_at, expires_at, confirmed_at,
            send_count, last_sent_at, attempts_confirm
     FROM api_token_requests
     WHERE email = ?
       AND status = 'pending'
     ORDER BY id DESC
     LIMIT 1
     FOR UPDATE`,
    [email]
  );
  return rows[0] || null;
}

async function selectById(conn, id) {
  const rows = await conn.query(
    `SELECT id, email, status, days, created_at, expires_at, confirmed_at,
            send_count, last_sent_at, attempts_confirm
     FROM api_token_requests
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
      const delayMs = randomIntBetween(RETRY_MIN_DELAY_MS, RETRY_MAX_DELAY_MS);
      await sleep(delayMs);
    }
  }
  throw new Error("tx_retry_exhausted");
}

const apiTokenRequestsRepository = {
  /**
   * @param {string} email
   * @returns {Promise<object | null>}
   */
  async getActivePendingByEmail(email) {
    const rows = await query(
      `SELECT id, email, status, days, created_at, expires_at, confirmed_at,
              send_count, last_sent_at, attempts_confirm
       FROM api_token_requests
       WHERE email = ?
         AND status = 'pending'
         AND expires_at > NOW(6)
       ORDER BY id DESC
       LIMIT 1`,
      [email]
    );
    return rows[0] || null;
  },

  /**
   * @param {object} payload
   * @returns {Promise<object | null>}
   */
  async createPending({ email, tokenHash32, ttlMinutes, requestIpPacked, userAgentOrNull, days }) {
    assertTokenHash32(tokenHash32);
    const ttl = assertTtlMinutes(ttlMinutes);

    return withTx(async (conn) => {
      const result = await conn.query(
        `INSERT INTO api_token_requests (
          email, token_hash, status, days, created_at, expires_at,
          request_ip, user_agent, send_count, last_sent_at, attempts_confirm
        ) VALUES (
          ?, ?, 'pending', ?, NOW(6), DATE_ADD(NOW(6), INTERVAL ? MINUTE),
          ?, ?, 1, NOW(6), 0
        )`,
        [email, tokenHash32, days, ttl, requestIpPacked, userAgentOrNull || null]
      );

      const rows = await conn.query(
        `SELECT id, email, status, days, created_at, expires_at, confirmed_at,
                send_count, last_sent_at, attempts_confirm
         FROM api_token_requests
         WHERE id = ?
         LIMIT 1`,
        [result.insertId]
      );

      return rows[0] || null;
    });
  },

  /**
   * Create or rotate a pending API token request in a single transaction.
   * Handles stale pending rows, cooldown, and max send counts.
   * @param {object} payload
   * @returns {Promise<object>}
   */
  async upsertPendingByEmailTx({
    email,
    days,
    ttlMinutes,
    cooldownSeconds,
    maxSendCount,
    requestIpPacked,
    userAgentOrNull,
    tokenLength,
  }) {
    const ttl = assertTtlMinutes(ttlMinutes);
    const cooldown = normalizeCooldownSeconds(cooldownSeconds);
    const maxSends = normalizeMaxSendCount(maxSendCount);
    const tokenLen = normalizeTokenLength(tokenLength);

    return withTxRetry(async (conn) => {
      await conn.query(
        `UPDATE api_token_requests
         SET status = 'expired'
         WHERE email = ?
           AND status = 'pending'
           AND expires_at <= NOW(6)`,
        [email]
      );

      let pending = await selectPendingForUpdate(conn, email);

      if (pending && pending.expires_at && new Date(pending.expires_at).getTime() <= Date.now()) {
        await conn.query(
          `UPDATE api_token_requests
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
        const nowMs = Date.now();

        if (nextAllowedSendAt && nextAllowedSendAt.getTime() > nowMs) {
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
          const tokenPlain = generateBase62Token(tokenLen);
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
              [tokenHash32, days, ttl, requestIpPacked, userAgentOrNull || null, pending.id]
            );

            const refreshed = (await selectById(conn, pending.id)) || pending;
            return {
              action: "resent",
              token_plain: tokenPlain,
              pending: buildPendingMeta(refreshed, cooldown, maxSends),
            };
          } catch (err) {
            if (err && err.code === "ER_DUP_ENTRY" && attempt < 2) {
              continue;
            }
            throw err;
          }
        }
      }

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const tokenPlain = generateBase62Token(tokenLen);
        const tokenHash32 = sha256Buffer(tokenPlain);

        try {
          const result = await conn.query(
            `INSERT INTO api_token_requests (
              email, token_hash, status, days, created_at, expires_at,
              request_ip, user_agent, send_count, last_sent_at, attempts_confirm
            ) VALUES (
              ?, ?, 'pending', ?, NOW(6), DATE_ADD(NOW(6), INTERVAL ? MINUTE),
              ?, ?, 1, NOW(6), 0
            )`,
            [email, tokenHash32, days, ttl, requestIpPacked, userAgentOrNull || null]
          );

          const inserted = await selectById(conn, result.insertId);
          return {
            action: "created",
            token_plain: tokenPlain,
            pending: buildPendingMeta(inserted || {}, cooldown, maxSends),
          };
        } catch (err) {
          if (err && err.code === "ER_DUP_ENTRY") {
            const existing = await selectPendingForUpdate(conn, email);
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
   * @param {object} payload
   * @returns {Promise<boolean>}
   */
  async rotateTokenForPending({ email, tokenHash32, ttlMinutes, requestIpPacked, userAgentOrNull, days }) {
    assertTokenHash32(tokenHash32);
    const ttl = assertTtlMinutes(ttlMinutes);

    const result = await query(
      `UPDATE api_token_requests
       SET token_hash = ?,
           days = ?,
           expires_at = DATE_ADD(NOW(6), INTERVAL ? MINUTE),
           request_ip = ?,
           user_agent = ?,
           send_count = send_count + 1,
           last_sent_at = NOW(6)
       WHERE email = ?
         AND status = 'pending'
         AND expires_at > NOW(6)
       ORDER BY id DESC
       LIMIT 1`,
      [tokenHash32, days, ttl, requestIpPacked, userAgentOrNull || null, email]
    );

    return Boolean(result && result.affectedRows === 1);
  },

  /**
   * @param {Buffer} tokenHash32
   * @returns {Promise<object | null>}
   */
  async getPendingByTokenHash(tokenHash32) {
    assertTokenHash32(tokenHash32);
    const rows = await query(
      `SELECT id, email, status, days, created_at, expires_at, confirmed_at,
              send_count, last_sent_at, attempts_confirm
       FROM api_token_requests
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
   * @param {number} id
   * @returns {Promise<boolean>}
   */
  async markConfirmedById(id) {
    const result = await query(
      `UPDATE api_token_requests
       SET status = 'confirmed',
           confirmed_at = NOW(6)
       WHERE id = ?
         AND status = 'pending'
         AND expires_at > NOW(6)`,
      [id]
    );
    return Boolean(result && result.affectedRows === 1);
  },
};

module.exports = { apiTokenRequestsRepository };
