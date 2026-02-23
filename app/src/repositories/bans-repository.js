"use strict";

/**
 * @fileoverview Ban repository (SQL access).
 */

const { query } = require("./db");

const ACTIVE_WHERE =
  "revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW(6))";

async function getActiveBanRow(banType, banValue) {
  const rows = await query(
    `SELECT ban_type, ban_value, reason,
            created_at AS banned_at
     FROM api_bans
     WHERE ban_type = ? AND ban_value = ? AND ${ACTIVE_WHERE}
     ORDER BY id DESC
     LIMIT 1`,
    [banType, banValue]
  );
  return rows[0] || null;
}

const bansRepository = {
  /**
   * Fetch ban row by id.
   * @param {number} id
   * @returns {Promise<object | null>}
   */
  async getById(id) {
    const rows = await query(
      `SELECT id, ban_type, ban_value, reason, created_at, expires_at,
              revoked_at, revoked_reason
       FROM api_bans
       WHERE id = ?
       LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  },

  /**
   * @param {string} email
   * @returns {Promise<boolean>}
   */
  async isBannedEmail(email) {
    const rows = await query(
      `SELECT id FROM api_bans
       WHERE ban_type = 'email' AND ban_value = ? AND ${ACTIVE_WHERE}
       LIMIT 1`,
      [email]
    );
    return rows.length > 0;
  },

  /**
   * @param {string} name
   * @returns {Promise<boolean>}
   */
  async isBannedName(name) {
    const rows = await query(
      `SELECT id FROM api_bans
       WHERE ban_type = 'name' AND ban_value = ? AND ${ACTIVE_WHERE}
       LIMIT 1`,
      [name]
    );
    return rows.length > 0;
  },

  /**
   * @param {string} domain
   * @returns {Promise<boolean>}
   */
  async isBannedDomain(domain) {
    const rows = await query(
      `SELECT id FROM api_bans
       WHERE ban_type = 'domain' AND ban_value = ? AND ${ACTIVE_WHERE}
       LIMIT 1`,
      [domain]
    );
    return rows.length > 0;
  },

  /**
   * @param {string} ipString
   * @returns {Promise<boolean>}
   */
  async isBannedIP(ipString) {
    const rows = await query(
      `SELECT id FROM api_bans
       WHERE ban_type = 'ip' AND ban_value = ? AND ${ACTIVE_WHERE}
       LIMIT 1`,
      [ipString]
    );
    return rows.length > 0;
  },

  /**
   * Combined ban check.
   * @param {{ email?: string, domain?: string, ip?: string, name?: string }} params
   * @returns {Promise<{ banned: boolean, type: string | null }>}
   */
  async check({ email, domain, ip, name }) {
    const checks = [];

    if (email) checks.push(["email", email]);
    if (domain) checks.push(["domain", domain]);
    if (ip) checks.push(["ip", ip]);
    if (name) checks.push(["name", name]);

    if (checks.length === 0) return { banned: false, type: null };

    const tuples = checks.map(() => "(?, ?)").join(", ");
    const params = checks.flat();

    const rows = await query(
      `SELECT ban_type, ban_value
       FROM api_bans
       WHERE ${ACTIVE_WHERE}
         AND (ban_type, ban_value) IN (${tuples})
       LIMIT 1`,
      params
    );

    if (rows.length === 0) return { banned: false, type: null };
    return { banned: true, type: rows[0].ban_type };
  },

  /**
   * @param {string} email
   * @returns {Promise<object | null>}
   */
  async getBannedEmail(email) {
    return getActiveBanRow("email", email);
  },

  /**
   * @param {string} name
   * @returns {Promise<object | null>}
   */
  async getBannedName(name) {
    return getActiveBanRow("name", name);
  },

  /**
   * @param {string} domain
   * @returns {Promise<object | null>}
   */
  async getBannedDomain(domain) {
    return getActiveBanRow("domain", domain);
  },

  /**
   * @param {string} ipString
   * @returns {Promise<object | null>}
   */
  async getBannedIP(ipString) {
    return getActiveBanRow("ip", ipString);
  },

  /**
   * List bans with optional filters.
   * @param {{ limit: number, offset: number, banType?: string, banValue?: string, active?: number }} options
   * @returns {Promise<object[]>}
   */
  async listAll({ limit, offset, banType, banValue, active }) {
    const where = [];
    const params = [];

    if (banType) {
      where.push("ban_type = ?");
      params.push(banType);
    }
    if (banValue) {
      where.push("ban_value = ?");
      params.push(banValue);
    }
    if (active === 1) {
      where.push(ACTIVE_WHERE);
    } else if (active === 0) {
      where.push(`NOT (${ACTIVE_WHERE})`);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await query(
      `SELECT id, ban_type, ban_value, reason, created_at, expires_at,
              revoked_at, revoked_reason
       FROM api_bans
       ${whereSql}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return rows;
  },

  /**
   * Count bans with optional filters.
   * @param {{ banType?: string, banValue?: string, active?: number }} options
   * @returns {Promise<number>}
   */
  async countAll({ banType, banValue, active }) {
    const where = [];
    const params = [];

    if (banType) {
      where.push("ban_type = ?");
      params.push(banType);
    }
    if (banValue) {
      where.push("ban_value = ?");
      params.push(banValue);
    }
    if (active === 1) {
      where.push(ACTIVE_WHERE);
    } else if (active === 0) {
      where.push(`NOT (${ACTIVE_WHERE})`);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await query(
      `SELECT COUNT(*) AS total
       FROM api_bans
       ${whereSql}`,
      params
    );

    return Number(rows[0]?.total ?? 0);
  },

  /**
   * Create ban row.
   * @param {{ banType: string, banValue: string, reason?: string | null, expiresAt?: Date | null }} payload
   * @returns {Promise<{ ok: boolean, insertId: number | null }>}
   */
  async createBan({ banType, banValue, reason, expiresAt }) {
    const result = await query(
      `INSERT INTO api_bans (
        ban_type, ban_value, reason, created_at, expires_at, revoked_at, revoked_reason
      ) VALUES (
        ?, ?, ?, NOW(6), ?, NULL, NULL
      )`,
      [banType, banValue, reason || null, expiresAt || null]
    );

    return {
      ok: Boolean(result && result.affectedRows === 1),
      insertId: result?.insertId ?? null,
    };
  },

  /**
   * Update ban row by id.
   * @param {number} id
   * @param {{ banType?: string, banValue?: string, reason?: string | null, expiresAt?: Date | null, revokedAt?: Date | null, revokedReason?: string | null }} patch
   * @returns {Promise<boolean>}
   */
  async updateById(id, patch) {
    const updates = [];
    const params = [];

    if (patch.banType !== undefined) {
      updates.push("ban_type = ?");
      params.push(patch.banType);
    }
    if (patch.banValue !== undefined) {
      updates.push("ban_value = ?");
      params.push(patch.banValue);
    }
    if (patch.reason !== undefined) {
      updates.push("reason = ?");
      params.push(patch.reason);
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
      `UPDATE api_bans
       SET ${updates.join(", ")}
       WHERE id = ?
       LIMIT 1`,
      [...params, id]
    );

    return Boolean(result && result.affectedRows === 1);
  },

  /**
   * Revoke ban by id.
   * @param {number} id
   * @param {string | null} revokedReason
   * @returns {Promise<boolean>}
   */
  async revokeById(id, revokedReason) {
    const result = await query(
      `UPDATE api_bans
       SET revoked_at = NOW(6),
           revoked_reason = ?
       WHERE id = ?
       LIMIT 1`,
      [revokedReason || null, id]
    );
    return Boolean(result && result.affectedRows === 1);
  },
};

module.exports = { bansRepository };
