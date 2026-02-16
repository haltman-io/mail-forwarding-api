"use strict";

/**
 * @fileoverview Email confirmations repository (SQL access).
 */

const crypto = require("crypto");
const { query, withTx } = require("./db");
const { packIp16 } = require("../lib/ip-pack");
const {
  normalizeLowerTrim,
  isValidLocalPart,
  isValidDomain,
} = require("../lib/mailbox-validation");

function assertAliasName(name) {
  if (typeof name !== "string") throw new Error("invalid_alias_name");
  const value = normalizeLowerTrim(name);
  if (!isValidLocalPart(value)) throw new Error("invalid_alias_name");
  return value;
}

function assertDomain(domain) {
  if (typeof domain !== "string") throw new Error("invalid_alias_domain");
  const value = normalizeLowerTrim(domain);
  if (!isValidDomain(value)) throw new Error("invalid_alias_domain");
  return value;
}

function assertIntent(intent) {
  if (typeof intent !== "string") throw new Error("invalid_intent");
  const value = intent.trim().toLowerCase();
  if (!value || value.length > 32) throw new Error("invalid_intent");
  return value;
}

function assertTtlMinutes(ttlMinutes) {
  const num = Number(ttlMinutes);
  if (!Number.isFinite(num) || num <= 0 || num > 24 * 60) {
    throw new Error("invalid_ttlMinutes");
  }
  return Math.floor(num);
}

function assertTokenHash32(tokenHash32) {
  if (!Buffer.isBuffer(tokenHash32) || tokenHash32.length !== 32) {
    throw new Error("invalid_tokenHash32");
  }
  return tokenHash32;
}

/**
 * Compute a SHA-256 Buffer(32).
 * @param {string} value
 * @returns {Buffer}
 */
function sha25632(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest();
}

const emailConfirmationsRepository = {
  helpers: { sha25632, packIp16 },

  /**
   * @param {string} email
   * @returns {Promise<object | null>}
   */
  async getActivePendingByEmail(email) {
    const rows = await query(
      `SELECT id, email, status, created_at, expires_at,
              send_count, last_sent_at, attempts_confirm,
              intent, alias_name, alias_domain
       FROM email_confirmations
       WHERE email = ? AND status = 'pending'
         AND expires_at > NOW(6)
       ORDER BY id DESC
       LIMIT 1`,
      [email]
    );
    return rows[0] || null;
  },

  /**
   * Create a new pending confirmation.
   * @param {object} payload
   * @returns {Promise<object | null>}
   */
  async createPending({
    email,
    tokenHash32,
    ttlMinutes,
    requestIpStringOrNull,
    userAgentOrNull,
    intent,
    aliasName,
    aliasDomain,
  }) {
    assertTokenHash32(tokenHash32);
    const ttl = assertTtlMinutes(ttlMinutes);
    const normalizedIntent = assertIntent(intent);
    const normalizedAliasName = assertAliasName(aliasName);
    const normalizedAliasDomain = assertDomain(aliasDomain);

    return withTx(async (conn) => {
      const packedIp =
        requestIpStringOrNull && typeof requestIpStringOrNull === "string"
          ? packIp16(requestIpStringOrNull)
          : null;

      await conn.query(
        `UPDATE email_confirmations
         SET status = 'expired'
         WHERE email = ?
           AND status = 'pending'
           AND expires_at <= NOW(6)`,
        [email]
      );

      const sql = `INSERT INTO email_confirmations (
          email, token_hash, status, created_at, expires_at,
          request_ip, user_agent, send_count, last_sent_at,
          attempts_confirm,
          intent, alias_name, alias_domain
        ) VALUES (
          ?, ?, 'pending', NOW(6), DATE_ADD(NOW(6), INTERVAL ? MINUTE),
          ?, ?, 1, NOW(6),
          0,
          ?, ?, ?
        )`;

      const result = await conn.query(sql, [
        email,
        tokenHash32,
        ttl,
        packedIp,
        userAgentOrNull || null,
        normalizedIntent,
        normalizedAliasName,
        normalizedAliasDomain,
      ]);

      const rows = await conn.query(
        `SELECT id, email, status, created_at, expires_at,
                send_count, last_sent_at, attempts_confirm,
                intent, alias_name, alias_domain
         FROM email_confirmations
         WHERE id = ?
         LIMIT 1`,
        [result.insertId]
      );

      return rows[0] || null;
    });
  },

  /**
   * Rotate token for an existing pending confirmation.
   * @param {object} payload
   * @returns {Promise<boolean>}
   */
  async rotateTokenForPending({
    email,
    tokenHash32,
    ttlMinutes,
    requestIpStringOrNull,
    userAgentOrNull,
  }) {
    assertTokenHash32(tokenHash32);
    const ttl = assertTtlMinutes(ttlMinutes);

    const packedIp =
      requestIpStringOrNull && typeof requestIpStringOrNull === "string"
        ? packIp16(requestIpStringOrNull)
        : null;

    const sql = `UPDATE email_confirmations
      SET token_hash = ?,
          expires_at = DATE_ADD(NOW(6), INTERVAL ? MINUTE),
          request_ip = ?,
          user_agent = ?,
          send_count = send_count + 1,
          last_sent_at = NOW(6)
      WHERE email = ?
        AND status = 'pending'
        AND expires_at > NOW(6)
      ORDER BY id DESC
      LIMIT 1`;

    const result = await query(sql, [
      tokenHash32,
      ttl,
      packedIp,
      userAgentOrNull || null,
      email,
    ]);

    return Boolean(result && result.affectedRows === 1);
  },

  /**
   * @param {Buffer} tokenHash32
   * @returns {Promise<object | null>}
   */
  async getPendingByTokenHash(tokenHash32) {
    assertTokenHash32(tokenHash32);

    const rows = await query(
      `SELECT id, email, status, created_at, expires_at,
              send_count, last_sent_at, attempts_confirm,
              intent, alias_name, alias_domain
       FROM email_confirmations
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
      `UPDATE email_confirmations
       SET status = 'confirmed',
           confirmed_at = NOW(6)
       WHERE id = ?
         AND status = 'pending'
         AND expires_at > NOW(6)`,
      [id]
    );
    return Boolean(result && result.affectedRows === 1);
  },

  /**
   * @param {number} id
   * @returns {Promise<boolean>}
   */
  async markExpiredById(id) {
    const result = await query(
      `UPDATE email_confirmations
       SET status = 'expired'
       WHERE id = ?
         AND status = 'pending'`,
      [id]
    );
    return Boolean(result && result.affectedRows >= 0);
  },

  /**
   * @param {number} id
   * @returns {Promise<boolean>}
   */
  async bumpAttemptsConfirmById(id) {
    const result = await query(
      `UPDATE email_confirmations
       SET attempts_confirm = attempts_confirm + 1
       WHERE id = ?`,
      [id]
    );
    return Boolean(result && result.affectedRows >= 0);
  },
};

module.exports = { emailConfirmationsRepository };
