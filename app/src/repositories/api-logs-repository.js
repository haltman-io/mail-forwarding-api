"use strict";

/**
 * @fileoverview API logs repository (SQL access).
 */

const { query } = require("./db");

const apiLogsRepository = {
  /**
   * @param {object} payload
   * @returns {Promise<boolean>}
   */
  async insert({ apiTokenId, ownerEmail, route, body, requestIpPacked, userAgent }) {
    await query(
      `INSERT INTO api_logs (
        api_token_id, api_token_owner_email, created_at, route, body, request_ip, user_agent
      ) VALUES (
        ?, ?, NOW(6), ?, ?, ?, ?
      )`,
      [
        apiTokenId,
        ownerEmail,
        String(route || "").slice(0, 128),
        body || null,
        requestIpPacked || null,
        userAgent || null,
      ]
    );
    return true;
  },
};

module.exports = { apiLogsRepository };
