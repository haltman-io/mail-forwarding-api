"use strict";

/**
 * @fileoverview Domain repository (SQL access).
 */

const { query } = require("./db");

const domainRepository = {
  /**
   * Fetch a domain by id.
   * @param {number} id
   * @returns {Promise<object | null>}
   */
  async getById(id) {
    const rows = await query(
      "SELECT id, name, active FROM domain WHERE id = ? LIMIT 1",
      [id]
    );
    return rows[0] || null;
  },

  /**
   * Fetch a domain by exact name.
   * @param {string} name
   * @returns {Promise<object | null>}
   */
  async getByName(name) {
    const rows = await query(
      "SELECT id, name, active FROM domain WHERE name = ? LIMIT 1",
      [name]
    );
    return rows[0] || null;
  },

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

  /**
   * List domains with optional active filter.
   * @param {{ limit: number, offset: number, active?: number }} options
   * @returns {Promise<object[]>}
   */
  async listAll({ limit, offset, active }) {
    const where = [];
    const params = [];

    if (active === 0 || active === 1) {
      where.push("active = ?");
      params.push(active);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await query(
      `SELECT id, name, active
       FROM domain
       ${whereSql}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return rows;
  },

  /**
   * Count domains with optional active filter.
   * @param {{ active?: number }} options
   * @returns {Promise<number>}
   */
  async countAll({ active }) {
    const where = [];
    const params = [];

    if (active === 0 || active === 1) {
      where.push("active = ?");
      params.push(active);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await query(
      `SELECT COUNT(*) AS total
       FROM domain
       ${whereSql}`,
      params
    );

    return Number(rows[0]?.total ?? 0);
  },

  /**
   * Create a domain row.
   * @param {{ name: string, active?: number }} payload
   * @returns {Promise<{ ok: boolean, insertId: number | null }>}
   */
  async createDomain({ name, active = 1 }) {
    const result = await query(
      `INSERT INTO domain (name, active)
       VALUES (?, ?)`,
      [name, active ? 1 : 0]
    );

    return {
      ok: Boolean(result && result.affectedRows === 1),
      insertId: result?.insertId ?? null,
    };
  },

  /**
   * Update domain fields by id.
   * @param {number} id
   * @param {{ name?: string, active?: number }} patch
   * @returns {Promise<boolean>}
   */
  async updateById(id, patch) {
    const updates = [];
    const params = [];

    if (patch.name !== undefined) {
      updates.push("name = ?");
      params.push(patch.name);
    }
    if (patch.active === 0 || patch.active === 1) {
      updates.push("active = ?");
      params.push(patch.active);
    }
    if (updates.length === 0) return false;

    const result = await query(
      `UPDATE domain
       SET ${updates.join(", ")}
       WHERE id = ?
       LIMIT 1`,
      [...params, id]
    );

    return Boolean(result && result.affectedRows === 1);
  },

  /**
   * Soft-delete a domain (set active=0).
   * @param {number} id
   * @returns {Promise<boolean>}
   */
  async disableById(id) {
    const result = await query(
      `UPDATE domain
       SET active = 0
       WHERE id = ?
       LIMIT 1`,
      [id]
    );
    return Boolean(result && result.affectedRows === 1);
  },
};

module.exports = { domainRepository };
