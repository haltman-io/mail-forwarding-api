"use strict";

/**
 * @fileoverview API tokens repository (SQL access).
 */

const { query } = require("./db");

function assertTokenHash32(buf) {
  if (!Buffer.isBuffer(buf) || buf.length !== 32) throw new Error("invalid_token_hash");
}

const apiTokensRepository = {
  /**
   * @param {object} payload
   * @returns {Promise<{ ok: boolean, insertId: number | null }>}
   */
  async createToken({ ownerEmail, tokenHash32, days, createdIpPacked, userAgentOrNull }) {
    assertTokenHash32(tokenHash32);

    const numDays = Number(days);
    if (!Number.isInteger(numDays) || numDays <= 0 || numDays > 90) throw new Error("invalid_days");

    const result = await query(
      `INSERT INTO api_tokens (
        owner_email, token_hash, status, created_at, expires_at,
        created_ip, user_agent
      ) VALUES (
        ?, ?, 'active', NOW(6), DATE_ADD(NOW(6), INTERVAL ? DAY),
        ?, ?
      )`,
      [ownerEmail, tokenHash32, numDays, createdIpPacked, userAgentOrNull || null]
    );

    return { ok: Boolean(result && result.affectedRows === 1), insertId: result?.insertId ?? null };
  },

  /**
   * @param {Buffer} tokenHash32
   * @returns {Promise<object | null>}
   */
  async getActiveByTokenHash(tokenHash32) {
    assertTokenHash32(tokenHash32);

    const rows = await query(
      `SELECT id, owner_email, status, created_at, expires_at, revoked_at
       FROM api_tokens
       WHERE token_hash = ?
         AND status = 'active'
         AND revoked_at IS NULL
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
  async touchLastUsed(id) {
    await query(
      `UPDATE api_tokens
       SET last_used_at = NOW(6)
       WHERE id = ?
       LIMIT 1`,
      [id]
    );
    return true;
  },
};

module.exports = { apiTokensRepository };
