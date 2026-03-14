"use strict";

/**
 * @fileoverview Auth register request repository (SQL access).
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

function assertTokenHash32(buf) {
  if (!Buffer.isBuffer(buf) || buf.length !== 32) throw new Error("invalid_token_hash");
}

function assertEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!email || email.length > 254) throw new Error("invalid_email");
  return email;
}

function assertPasswordHash(value) {
  const passwordHash = String(value || "").trim();
  if (!passwordHash || passwordHash.length > 255) throw new Error("invalid_password_hash");
  return passwordHash;
}

function assertTtlMinutes(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0 || num > 24 * 60) {
    throw new Error("invalid_ttl_minutes");
  }
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
    `SELECT id, email, password_hash, status, created_at, expires_at, confirmed_at,
            send_count, last_sent_at, attempts_confirm
     FROM auth_register_requests
     WHERE email = ?
       AND status = 'pending'
     ORDER BY id DESC
     LIMIT 1
     FOR UPDATE`,
    [email]
  );
  return rows[0] || null;
}

async function selectPendingByTokenForUpdate(conn, tokenHash32) {
  const rows = await conn.query(
    `SELECT id, email, password_hash, status, created_at, expires_at, confirmed_at,
            send_count, last_sent_at, attempts_confirm
     FROM auth_register_requests
     WHERE token_hash = ?
       AND status = 'pending'
       AND expires_at > NOW(6)
     ORDER BY id DESC
     LIMIT 1
     FOR UPDATE`,
    [tokenHash32]
  );
  return rows[0] || null;
}

async function selectById(conn, id) {
  const rows = await conn.query(
    `SELECT id, email, password_hash, status, created_at, expires_at, confirmed_at,
            send_count, last_sent_at, attempts_confirm
     FROM auth_register_requests
     WHERE id = ?
     LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function selectExistingUserByEmail(conn, email) {
  const rows = await conn.query(
    `SELECT id, email
     FROM users
     WHERE email = ?
     LIMIT 1
     FOR UPDATE`,
    [email]
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

const authRegisterRequestsRepository = {
  /**
   * @param {Buffer} tokenHash32
   * @returns {Promise<object | null>}
   */
  async getPendingByTokenHash(tokenHash32) {
    assertTokenHash32(tokenHash32);

    const rows = await query(
      `SELECT id, email, password_hash, status, created_at, expires_at, confirmed_at,
              send_count, last_sent_at, attempts_confirm
       FROM auth_register_requests
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
   * Create or rotate a pending register confirmation in a single transaction.
   * @param {object} payload
   * @returns {Promise<object>}
   */
  async upsertPendingByEmailTx({
    email,
    passwordHash,
    ttlMinutes,
    cooldownSeconds,
    maxSendCount,
    requestIpPacked,
    userAgentOrNull,
  }) {
    const normalizedEmail = assertEmail(email);
    const normalizedPasswordHash = assertPasswordHash(passwordHash);
    const ttl = assertTtlMinutes(ttlMinutes);
    const cooldown = normalizeCooldownSeconds(cooldownSeconds);
    const maxSends = normalizeMaxSendCount(maxSendCount);

    return withTxRetry(async (conn) => {
      const existingUser = await selectExistingUserByEmail(conn, normalizedEmail);
      if (existingUser && existingUser.id) {
        return { action: "taken", email: normalizedEmail };
      }

      await conn.query(
        `UPDATE auth_register_requests
         SET status = 'expired'
         WHERE email = ?
           AND status = 'pending'
           AND expires_at <= NOW(6)`,
        [normalizedEmail]
      );

      let pending = await selectPendingForUpdate(conn, normalizedEmail);

      if (pending && pending.expires_at && new Date(pending.expires_at).getTime() <= Date.now()) {
        await conn.query(
          `UPDATE auth_register_requests
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
              `UPDATE auth_register_requests
               SET token_hash = ?,
                   expires_at = DATE_ADD(NOW(6), INTERVAL ? MINUTE),
                   request_ip = ?,
                   user_agent = ?,
                   send_count = send_count + 1,
                   last_sent_at = NOW(6)
               WHERE id = ?`,
              [
                tokenHash32,
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
            `INSERT INTO auth_register_requests (
              email, password_hash, token_hash, status, created_at, expires_at,
              request_ip, user_agent, send_count, last_sent_at, attempts_confirm
            ) VALUES (
              ?, ?, ?, 'pending', NOW(6), DATE_ADD(NOW(6), INTERVAL ? MINUTE),
              ?, ?, 1, NOW(6), 0
            )`,
            [
              normalizedEmail,
              normalizedPasswordHash,
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
            const existing = await selectPendingForUpdate(conn, normalizedEmail);
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
   * Consume a pending registration token and create the user in one transaction.
   * @param {object} payload
   * @returns {Promise<{ ok: boolean, reason?: string, user?: object, email?: string }>}
   */
  async consumePendingAndCreateUserTx({ tokenHash32 }) {
    assertTokenHash32(tokenHash32);

    try {
      return await withTxRetry(async (conn) => {
        const pending = await selectPendingByTokenForUpdate(conn, tokenHash32);
        if (!pending) return { ok: false, reason: "invalid_or_expired" };

        const existingUser = await selectExistingUserByEmail(conn, pending.email);
        if (existingUser && existingUser.id) {
          await conn.query(
            `UPDATE auth_register_requests
             SET status = 'expired'
             WHERE id = ?
               AND status = 'pending'`,
            [pending.id]
          );
          return {
            ok: false,
            reason: "user_taken",
            email: String(pending.email || "").trim().toLowerCase(),
          };
        }

        const confirmResult = await conn.query(
          `UPDATE auth_register_requests
           SET status = 'confirmed',
               confirmed_at = NOW(6)
           WHERE id = ?
             AND status = 'pending'
             AND expires_at > NOW(6)`,
          [pending.id]
        );

        if (!confirmResult || confirmResult.affectedRows !== 1) {
          return { ok: false, reason: "invalid_or_expired" };
        }

        const created = await conn.query(
          `INSERT INTO users (
            email, password_hash, is_active, is_admin, created_at, updated_at
          ) VALUES (
            ?, ?, 1, 0, NOW(6), NOW(6)
          )`,
          [pending.email, pending.password_hash]
        );

        await conn.query(
          `UPDATE auth_register_requests
           SET status = 'expired'
           WHERE email = ?
             AND id <> ?
             AND status = 'pending'`,
          [pending.email, pending.id]
        );

        const userRows = await conn.query(
          `SELECT id, email, password_hash, is_active, is_admin, created_at, updated_at, last_login_at
           FROM users
           WHERE id = ?
           LIMIT 1`,
          [created.insertId]
        );

        return {
          ok: true,
          user: userRows[0] || null,
        };
      });
    } catch (err) {
      if (err && err.code === "ER_DUP_ENTRY") {
        return { ok: false, reason: "user_taken" };
      }
      throw err;
    }
  },
};

module.exports = {
  authRegisterRequestsRepository,
};
