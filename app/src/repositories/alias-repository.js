"use strict";

/**
 * @fileoverview Alias repository (SQL access).
 */

const { query, withTx } = require("./db");

/**
 * Alias data access layer.
 */
const aliasRepository = {
  /**
   * Fetch a single alias by address.
   * @param {string} address
   * @returns {Promise<object | null>}
   */
  async getByAddress(address) {
    const rows = await query(
      `SELECT id, address, goto, active, domain_id, created, modified
       FROM alias
       WHERE address = ?
       LIMIT 1`,
      [address]
    );
    return rows[0] || null;
  },

  /**
   * Check if an alias exists regardless of active status.
   * @param {string} address
   * @returns {Promise<boolean>}
   */
  async existsByAddress(address) {
    const rows = await query(
      `SELECT 1 AS ok
       FROM alias
       WHERE address = ?
       LIMIT 1`,
      [address]
    );
    return rows.length === 1;
  },

  /**
   * Create a new alias row.
   * @param {{ address: string, goto: string, domainId: number, active?: number | boolean }} payload
   * @returns {Promise<{ ok: boolean, insertId: number | null }>} 
   */
  async createAlias({ address, goto, domainId, active = 1 }) {
    if (!address || typeof address !== "string") throw new Error("invalid_address");
    if (!goto || typeof goto !== "string") throw new Error("invalid_goto");
    if (!Number.isInteger(domainId) || domainId <= 0) throw new Error("invalid_domain_id");

    const act = active ? 1 : 0;

    const result = await query(
      `INSERT INTO alias (address, goto, active, domain_id, created, modified)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
      [address, goto, act, domainId]
    );

    return {
      ok: Boolean(result && result.affectedRows === 1),
      insertId: result?.insertId ?? null,
    };
  },

  /**
   * Create alias with a best-effort race guard.
   * @param {{ address: string, goto: string, domainId: number, active?: number | boolean }} payload
   * @returns {Promise<{ ok: boolean, created: boolean, alreadyExists?: boolean, row?: object, insertId?: number | null }>}
   */
  async createIfNotExists({ address, goto, domainId, active = 1 }) {
    return withTx(async (conn) => {
      const rows = await conn.query(
        `SELECT id, address, goto, active, domain_id
         FROM alias
         WHERE address = ?
         FOR UPDATE`,
        [address]
      );

      if (rows.length === 1) {
        return { ok: false, created: false, alreadyExists: true, row: rows[0] };
      }

      const act = active ? 1 : 0;

      const result = await conn.query(
        `INSERT INTO alias (address, goto, active, domain_id, created, modified)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
        [address, goto, act, domainId]
      );

      return { ok: true, created: true, insertId: result?.insertId ?? null };
    });
  },

  /**
   * List aliases by destination (goto).
   * @param {string} goto
   * @returns {Promise<object[]>}
   */
  async listByGoto(goto) {
    if (!goto || typeof goto !== "string") throw new Error("invalid_goto");

    const rows = await query(
      `SELECT id, address, goto, active, domain_id, created, modified
       FROM alias
       WHERE goto = ?
       ORDER BY id DESC`,
      [goto.trim().toLowerCase()]
    );

    return rows;
  },

  /**
   * Delete alias by address.
   * @param {string} address
   * @returns {Promise<{ ok: boolean, deleted: boolean, affectedRows: number }>}
   */
  async deleteByAddress(address) {
    return withTx(async (conn) => {
      const result = await conn.query(
        `DELETE FROM alias
         WHERE address = ?
         LIMIT 1`,
        [address]
      );
      const affected = Number(result?.affectedRows ?? 0);
      return { ok: true, deleted: affected === 1, affectedRows: affected };
    });
  },
};

module.exports = { aliasRepository };
