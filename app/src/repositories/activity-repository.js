"use strict";

/**
 * @fileoverview Activity repository (SQL access).
 */

const { query } = require("./db");

const activityRepository = {
  /**
   * List owner activity events.
   * @param {string} ownerEmail
   * @param {{ limit: number, offset: number }} options
   * @returns {Promise<Array<{ type: string, occurred_at: string, route: string | null, intent: string | null, alias: string | null }>>}
   */
  async listByOwner(ownerEmail, { limit, offset }) {
    if (!ownerEmail || typeof ownerEmail !== "string") throw new Error("invalid_owner_email");
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 50;
    const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;

    const rows = await query(
      `SELECT *
       FROM (
         SELECT
           CASE
             WHEN l.route LIKE '/api/alias/create%' THEN 'alias_create'
             ELSE 'alias_delete'
           END AS type,
           l.created_at AS occurred_at,
           l.route AS route,
           NULL AS intent,
           NULL AS alias
         FROM api_logs l
         WHERE l.api_token_owner_email = ?
           AND (l.route LIKE '/api/alias/create%' OR l.route LIKE '/api/alias/delete%')

         UNION ALL

         SELECT
           CONCAT('confirm_', c.intent) AS type,
           c.confirmed_at AS occurred_at,
           '/forward/confirm' AS route,
           c.intent AS intent,
           CASE
             WHEN c.alias_name IS NOT NULL AND c.alias_domain IS NOT NULL
               THEN CONCAT(c.alias_name, '@', c.alias_domain)
             ELSE NULL
           END AS alias
         FROM email_confirmations c
         WHERE c.email = ?
           AND c.status = 'confirmed'
           AND c.confirmed_at IS NOT NULL
       ) activity
       ORDER BY occurred_at DESC
       LIMIT ? OFFSET ?`,
      [ownerEmail.trim().toLowerCase(), ownerEmail.trim().toLowerCase(), safeLimit, safeOffset]
    );

    return rows;
  },
};

module.exports = { activityRepository };
