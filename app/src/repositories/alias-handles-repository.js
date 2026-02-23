"use strict";

/**
 * @fileoverview Alias-handle repository (SQL access).
 */

const { query } = require("./db");

const aliasHandlesRepository = {
  /**
   * Fetch a handle by id.
   * @param {number} id
   * @returns {Promise<object | null>}
   */
  async getById(id) {
    const rows = await query(
      `SELECT id, handle, address, active
       FROM alias_handle
       WHERE id = ?
       LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  },

  /**
   * Fetch a handle by exact handle value.
   * @param {string} handle
   * @returns {Promise<object | null>}
   */
  async getByHandle(handle) {
    const rows = await query(
      `SELECT id, handle, address, active
       FROM alias_handle
       WHERE handle = ?
       LIMIT 1`,
      [handle]
    );
    return rows[0] || null;
  },

  /**
   * List handles with optional filters.
   * @param {{ limit: number, offset: number, active?: number, handle?: string, address?: string }} options
   * @returns {Promise<object[]>}
   */
  async listAll({ limit, offset, active, handle, address }) {
    const where = [];
    const params = [];

    if (active === 0 || active === 1) {
      where.push("active = ?");
      params.push(active);
    }
    if (handle) {
      where.push("handle = ?");
      params.push(handle);
    }
    if (address) {
      where.push("address = ?");
      params.push(address);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await query(
      `SELECT id, handle, address, active
       FROM alias_handle
       ${whereSql}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return rows;
  },

  /**
   * Count handles with optional filters.
   * @param {{ active?: number, handle?: string, address?: string }} options
   * @returns {Promise<number>}
   */
  async countAll({ active, handle, address }) {
    const where = [];
    const params = [];

    if (active === 0 || active === 1) {
      where.push("active = ?");
      params.push(active);
    }
    if (handle) {
      where.push("handle = ?");
      params.push(handle);
    }
    if (address) {
      where.push("address = ?");
      params.push(address);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await query(
      `SELECT COUNT(*) AS total
       FROM alias_handle
       ${whereSql}`,
      params
    );

    return Number(rows[0]?.total ?? 0);
  },

  /**
   * Create a handle row.
   * @param {{ handle: string, address: string, active?: number }} payload
   * @returns {Promise<{ ok: boolean, insertId: number | null }>}
   */
  async createHandle({ handle, address, active = 1 }) {
    const result = await query(
      `INSERT INTO alias_handle (handle, address, active)
       VALUES (?, ?, ?)`,
      [handle, address, active ? 1 : 0]
    );

    return {
      ok: Boolean(result && result.affectedRows === 1),
      insertId: result?.insertId ?? null,
    };
  },

  /**
   * Update handle fields by id.
   * @param {number} id
   * @param {{ handle?: string, address?: string, active?: number }} patch
   * @returns {Promise<boolean>}
   */
  async updateById(id, patch) {
    const updates = [];
    const params = [];

    if (patch.handle !== undefined) {
      updates.push("handle = ?");
      params.push(patch.handle);
    }
    if (patch.address !== undefined) {
      updates.push("address = ?");
      params.push(patch.address);
    }
    if (patch.active === 0 || patch.active === 1) {
      updates.push("active = ?");
      params.push(patch.active);
    }
    if (updates.length === 0) return false;

    const result = await query(
      `UPDATE alias_handle
       SET ${updates.join(", ")}
       WHERE id = ?
       LIMIT 1`,
      [...params, id]
    );

    return Boolean(result && result.affectedRows === 1);
  },

  /**
   * Soft-delete a handle (set active=0).
   * @param {number} id
   * @returns {Promise<boolean>}
   */
  async disableById(id) {
    const result = await query(
      `UPDATE alias_handle
       SET active = 0
       WHERE id = ?
       LIMIT 1`,
      [id]
    );

    return Boolean(result && result.affectedRows === 1);
  },
};

module.exports = { aliasHandlesRepository };
