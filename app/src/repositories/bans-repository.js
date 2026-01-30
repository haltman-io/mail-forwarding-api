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
};

module.exports = { bansRepository };
