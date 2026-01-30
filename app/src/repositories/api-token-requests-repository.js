"use strict";

/**
 * @fileoverview API token request repository (SQL access).
 */

const { query, withTx } = require("./db");

function assertTokenHash32(buf) {
  if (!Buffer.isBuffer(buf) || buf.length !== 32) throw new Error("invalid_token_hash");
}

function assertTtlMinutes(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0 || num > 60) throw new Error("invalid_ttl_minutes");
  return Math.floor(num);
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
