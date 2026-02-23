"use strict";

/**
 * @fileoverview Admin authentication repository (users + sessions).
 */

const { query } = require("./db");

function assertTokenHash32(buf) {
  if (!Buffer.isBuffer(buf) || buf.length !== 32) throw new Error("invalid_token_hash");
}

function assertSessionTtlMinutes(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 5 || num > 7 * 24 * 60) {
    throw new Error("invalid_session_ttl_minutes");
  }
  return Math.floor(num);
}

function buildContainsLikePattern(raw) {
  const normalized = String(raw || "").trim().toLowerCase();
  if (!normalized) return null;
  const escaped = normalized.replace(/[\\%_]/g, "\\$&");
  return `%${escaped}%`;
}

const adminAuthRepository = {
  /**
   * @param {number} id
   * @returns {Promise<object | null>}
   */
  async getUserById(id) {
    const rows = await query(
      `SELECT id, email, password_hash, is_active, created_at, updated_at, last_login_at
       FROM admin_users
       WHERE id = ?
       LIMIT 1`,
      [id]
    );

    return rows[0] || null;
  },

  /**
   * @param {string} email
   * @returns {Promise<object | null>}
   */
  async getUserByEmail(email) {
    const rows = await query(
      `SELECT id, email, password_hash, is_active, created_at, updated_at, last_login_at
       FROM admin_users
       WHERE email = ?
       LIMIT 1`,
      [email]
    );

    return rows[0] || null;
  },

  /**
   * @param {string} email
   * @returns {Promise<object | null>}
   */
  async getActiveUserByEmail(email) {
    const rows = await query(
      `SELECT id, email, password_hash, is_active, created_at, last_login_at
       FROM admin_users
       WHERE email = ?
         AND is_active = 1
       LIMIT 1`,
      [email]
    );

    return rows[0] || null;
  },

  /**
   * @param {{ limit: number, offset: number, active?: number, email?: string }} options
   * @returns {Promise<object[]>}
   */
  async listUsers({ limit, offset, active, email }) {
    const where = [];
    const params = [];

    if (active === 0 || active === 1) {
      where.push("is_active = ?");
      params.push(active);
    }
    const emailPattern = buildContainsLikePattern(email);
    if (emailPattern) {
      where.push("email LIKE ? ESCAPE '\\\\'");
      params.push(emailPattern);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await query(
      `SELECT id, email, password_hash, is_active, created_at, updated_at, last_login_at
       FROM admin_users
       ${whereSql}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return rows;
  },

  /**
   * @param {{ active?: number, email?: string }} options
   * @returns {Promise<number>}
   */
  async countUsers({ active, email }) {
    const where = [];
    const params = [];

    if (active === 0 || active === 1) {
      where.push("is_active = ?");
      params.push(active);
    }
    const emailPattern = buildContainsLikePattern(email);
    if (emailPattern) {
      where.push("email LIKE ? ESCAPE '\\\\'");
      params.push(emailPattern);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await query(
      `SELECT COUNT(*) AS total
       FROM admin_users
       ${whereSql}`,
      params
    );

    return Number(rows[0]?.total ?? 0);
  },

  /**
   * @param {{ email: string, passwordHash: string, isActive?: number }} payload
   * @returns {Promise<{ ok: boolean, insertId: number | null }>}
   */
  async createUser({ email, passwordHash, isActive = 1 }) {
    const result = await query(
      `INSERT INTO admin_users (
        email, password_hash, is_active, created_at, updated_at
      ) VALUES (
        ?, ?, ?, NOW(6), NOW(6)
      )`,
      [email, passwordHash, isActive ? 1 : 0]
    );

    return {
      ok: Boolean(result && result.affectedRows === 1),
      insertId: result?.insertId ?? null,
    };
  },

  /**
   * @param {number} id
   * @param {{ email?: string, passwordHash?: string, isActive?: number }} patch
   * @returns {Promise<boolean>}
   */
  async updateUserById(id, patch) {
    const updates = [];
    const params = [];

    if (patch.email !== undefined) {
      updates.push("email = ?");
      params.push(patch.email);
    }
    if (patch.passwordHash !== undefined) {
      updates.push("password_hash = ?");
      params.push(patch.passwordHash);
    }
    if (patch.isActive === 0 || patch.isActive === 1) {
      updates.push("is_active = ?");
      params.push(patch.isActive);
    }
    if (updates.length === 0) return false;

    updates.push("updated_at = NOW(6)");

    const result = await query(
      `UPDATE admin_users
       SET ${updates.join(", ")}
       WHERE id = ?
       LIMIT 1`,
      [...params, id]
    );

    return Boolean(result && result.affectedRows === 1);
  },

  /**
   * @param {number} id
   * @returns {Promise<boolean>}
   */
  async disableUserById(id) {
    const result = await query(
      `UPDATE admin_users
       SET is_active = 0,
           updated_at = NOW(6)
       WHERE id = ?
       LIMIT 1`,
      [id]
    );
    return Boolean(result && result.affectedRows === 1);
  },

  /**
   * @param {number} userId
   * @returns {Promise<boolean>}
   */
  async updateLastLoginAtById(userId) {
    const result = await query(
      `UPDATE admin_users
       SET last_login_at = NOW(6)
       WHERE id = ?
       LIMIT 1`,
      [userId]
    );
    return Boolean(result && result.affectedRows === 1);
  },

  /**
   * @param {object} payload
   * @returns {Promise<{ ok: boolean, insertId: number | null, expiresAt: Date | null }>}
   */
  async createSession({ adminUserId, tokenHash32, ttlMinutes, requestIpPacked, userAgentOrNull }) {
    assertTokenHash32(tokenHash32);
    const ttl = assertSessionTtlMinutes(ttlMinutes);

    const result = await query(
      `INSERT INTO admin_auth_sessions (
        admin_user_id, token_hash, status, created_at, expires_at,
        request_ip, user_agent
      ) VALUES (
        ?, ?, 'active', NOW(6), DATE_ADD(NOW(6), INTERVAL ? MINUTE),
        ?, ?
      )`,
      [adminUserId, tokenHash32, ttl, requestIpPacked, userAgentOrNull || null]
    );

    const rows = await query(
      `SELECT id, expires_at
       FROM admin_auth_sessions
       WHERE id = ?
       LIMIT 1`,
      [result.insertId]
    );
    const row = rows[0] || null;

    return {
      ok: Boolean(result && result.affectedRows === 1),
      insertId: result?.insertId ?? null,
      expiresAt: row?.expires_at || null,
    };
  },

  /**
   * @param {Buffer} tokenHash32
   * @returns {Promise<object | null>}
   */
  async getActiveSessionByTokenHash(tokenHash32) {
    assertTokenHash32(tokenHash32);

    const rows = await query(
      `SELECT
          s.id AS session_id,
          s.admin_user_id AS user_id,
          s.expires_at,
          s.last_used_at,
          u.email
       FROM admin_auth_sessions s
       INNER JOIN admin_users u ON u.id = s.admin_user_id
       WHERE s.token_hash = ?
         AND s.status = 'active'
         AND s.revoked_at IS NULL
         AND s.expires_at > NOW(6)
         AND u.is_active = 1
       ORDER BY s.id DESC
       LIMIT 1`,
      [tokenHash32]
    );

    return rows[0] || null;
  },

  /**
   * @param {number} sessionId
   * @returns {Promise<boolean>}
   */
  async touchSessionLastUsed(sessionId) {
    const result = await query(
      `UPDATE admin_auth_sessions
       SET last_used_at = NOW(6)
       WHERE id = ?
       LIMIT 1`,
      [sessionId]
    );
    return Boolean(result && result.affectedRows === 1);
  },

  /**
   * Revoke all active sessions for an admin user.
   * @param {number} userId
   * @param {{ exceptSessionId?: number }} [options]
   * @returns {Promise<number>}
   */
  async revokeSessionsByUserId(userId, options = {}) {
    const exceptSessionId =
      Number.isInteger(options.exceptSessionId) && options.exceptSessionId > 0
        ? options.exceptSessionId
        : null;

    const whereExtra = exceptSessionId ? "AND id <> ?" : "";
    const params = exceptSessionId ? [userId, exceptSessionId] : [userId];

    const result = await query(
      `UPDATE admin_auth_sessions
       SET status = 'revoked',
           revoked_at = NOW(6)
       WHERE admin_user_id = ?
         AND status = 'active'
         AND revoked_at IS NULL
         ${whereExtra}`,
      params
    );

    return Number(result?.affectedRows ?? 0);
  },
};

module.exports = { adminAuthRepository };
