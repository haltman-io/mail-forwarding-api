"use strict";

/**
 * @fileoverview Domain repository (SQL access).
 */

const { query } = require("./db");

const domainRepository = {
  /**
   * Fetch an active domain by name.
   * @param {string} name
   * @returns {Promise<object | null>}
   */
  async getActiveByName(name) {
    const rows = await query(
      "SELECT id, name, active FROM domain WHERE name = ? AND active = 1 LIMIT 1",
      [name]
    );
    return rows[0] || null;
  },

  /**
   * Check whether an active domain exists.
   * @param {string} name
   * @returns {Promise<boolean>}
   */
  async existsActive(name) {
    const rows = await query(
      "SELECT 1 AS ok FROM domain WHERE name = ? AND active = 1 LIMIT 1",
      [name]
    );
    return rows.length === 1;
  },

  /**
   * List active domain names.
   * @returns {Promise<string[]>}
   */
  async listActiveNames() {
    const rows = await query(
      "SELECT name FROM domain WHERE active = 1 ORDER BY id ASC"
    );

    return rows
      .filter((row) => row && typeof row === "object" && "name" in row)
      .map((row) => row.name);
  },
};

module.exports = { domainRepository };
