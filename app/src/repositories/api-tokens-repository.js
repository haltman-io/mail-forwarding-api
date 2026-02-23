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
   * @param {number} id
   * @returns {Promise<object | null>}
   */
  async getById(id) {
    const rows = await query(
      `SELECT
          id,
          owner_email,
          HEX(token_hash) AS token_hash,
          status,
          created_at,
          expires_at,
          revoked_at,
          revoked_reason,
          INET6_NTOA(created_ip) AS created_ip,
          user_agent,
          last_used_at
       FROM api_tokens
       WHERE id = ?
       LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  },

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

  /**
   * List api tokens with optional filters.
   * @param {{ limit: number, offset: number, ownerEmail?: string, status?: string, active?: number }} options
   * @returns {Promise<object[]>}
   */
  async listAll({ limit, offset, ownerEmail, status, active }) {
    const where = [];
    const params = [];

    if (ownerEmail) {
      where.push("owner_email = ?");
      params.push(ownerEmail);
    }
    if (status) {
      where.push("status = ?");
      params.push(status);
    }
    if (active === 1) {
      where.push("status = 'active' AND revoked_at IS NULL AND expires_at > NOW(6)");
    } else if (active === 0) {
      where.push("NOT (status = 'active' AND revoked_at IS NULL AND expires_at > NOW(6))");
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await query(
      `SELECT
          id,
          owner_email,
          HEX(token_hash) AS token_hash,
          status,
          created_at,
          expires_at,
          revoked_at,
          revoked_reason,
          INET6_NTOA(created_ip) AS created_ip,
          user_agent,
          last_used_at
       FROM api_tokens
       ${whereSql}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return rows;
  },

  /**
   * Count api tokens with optional filters.
   * @param {{ ownerEmail?: string, status?: string, active?: number }} options
   * @returns {Promise<number>}
   */
  async countAll({ ownerEmail, status, active }) {
    const where = [];
    const params = [];

    if (ownerEmail) {
      where.push("owner_email = ?");
      params.push(ownerEmail);
    }
    if (status) {
      where.push("status = ?");
      params.push(status);
    }
    if (active === 1) {
      where.push("status = 'active' AND revoked_at IS NULL AND expires_at > NOW(6)");
    } else if (active === 0) {
      where.push("NOT (status = 'active' AND revoked_at IS NULL AND expires_at > NOW(6))");
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await query(
      `SELECT COUNT(*) AS total
       FROM api_tokens
       ${whereSql}`,
      params
    );
    return Number(rows[0]?.total ?? 0);
  },

  /**
   * Update token row by id.
   * @param {number} id
   * @param {{ ownerEmail?: string, status?: string, expiresAt?: Date, revokedAt?: Date | null, revokedReason?: string | null }} patch
   * @returns {Promise<boolean>}
   */
  async updateById(id, patch) {
    const updates = [];
    const params = [];

    if (patch.ownerEmail !== undefined) {
      updates.push("owner_email = ?");
      params.push(patch.ownerEmail);
    }
    if (patch.status !== undefined) {
      updates.push("status = ?");
      params.push(patch.status);
    }
    if (patch.expiresAt !== undefined) {
      updates.push("expires_at = ?");
      params.push(patch.expiresAt);
    }
    if (patch.revokedAt !== undefined) {
      updates.push("revoked_at = ?");
      params.push(patch.revokedAt);
    }
    if (patch.revokedReason !== undefined) {
      updates.push("revoked_reason = ?");
      params.push(patch.revokedReason);
    }
    if (updates.length === 0) return false;

    const result = await query(
      `UPDATE api_tokens
       SET ${updates.join(", ")}
       WHERE id = ?
       LIMIT 1`,
      [...params, id]
    );
    return Boolean(result && result.affectedRows === 1);
  },

  /**
   * Revoke token by id.
   * @param {number} id
   * @param {string | null} revokedReason
   * @returns {Promise<boolean>}
   */
  async revokeById(id, revokedReason) {
    const result = await query(
      `UPDATE api_tokens
       SET status = 'revoked',
           revoked_at = NOW(6),
           revoked_reason = ?
       WHERE id = ?
       LIMIT 1`,
      [revokedReason || null, id]
    );
    return Boolean(result && result.affectedRows === 1);
  },
};

module.exports = { apiTokensRepository };
