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
   * Fetch a single alias by id.
   * @param {number} id
   * @returns {Promise<object | null>}
   */
  async getById(id) {
    const rows = await query(
      `SELECT a.id, a.address, a.goto, a.active, d.id AS domain_id, a.created, a.modified
       FROM alias a
       LEFT JOIN domain d
         ON d.name = SUBSTRING_INDEX(a.address, '@', -1)
       WHERE a.id = ?
       LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  },

  /**
   * Fetch a single alias by address.
   * @param {string} address
   * @returns {Promise<object | null>}
   */
  async getByAddress(address) {
    const rows = await query(
      `SELECT a.id, a.address, a.goto, a.active, d.id AS domain_id, a.created, a.modified
       FROM alias a
       LEFT JOIN domain d
         ON d.name = SUBSTRING_INDEX(a.address, '@', -1)
       WHERE a.address = ?
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
   * Check whether a handle is reserved in alias_handle and active.
   * @param {string} handle
   * @returns {Promise<boolean>}
   */
  async existsReservedHandle(handle) {
    const normalized = String(handle || "").trim().toLowerCase();
    if (!normalized) return false;

    const rows = await query(
      `SELECT 1 AS ok
       FROM alias_handle
       WHERE handle = ?
         AND active = 1
       LIMIT 1`,
      [normalized]
    );
    return rows.length === 1;
  },

  /**
   * Create a new alias row.
   * @param {{ address: string, goto: string, domainId?: number, active?: number | boolean }} payload
   * @returns {Promise<{ ok: boolean, insertId: number | null }>} 
   */
  async createAlias({ address, goto, domainId, active = 1 }) {
    if (!address || typeof address !== "string") throw new Error("invalid_address");
    if (!goto || typeof goto !== "string") throw new Error("invalid_goto");
    if (domainId !== undefined && domainId !== null) {
      if (!Number.isInteger(domainId) || domainId <= 0) throw new Error("invalid_domain_id");
    }

    const act = active ? 1 : 0;

    const result = await query(
      `INSERT INTO alias (address, goto, active, created, modified)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
      [address, goto, act]
    );

    return {
      ok: Boolean(result && result.affectedRows === 1),
      insertId: result?.insertId ?? null,
    };
  },

  /**
   * Create alias with a best-effort race guard.
   * @param {{ address: string, goto: string, domainId?: number, active?: number | boolean }} payload
   * @returns {Promise<{ ok: boolean, created: boolean, alreadyExists?: boolean, row?: object, insertId?: number | null }>}
   */
  async createIfNotExists({ address, goto, domainId, active = 1 }) {
    if (domainId !== undefined && domainId !== null) {
      if (!Number.isInteger(domainId) || domainId <= 0) throw new Error("invalid_domain_id");
    }
    return withTx(async (conn) => {
      const rows = await conn.query(
        `SELECT a.id, a.address, a.goto, a.active, d.id AS domain_id
         FROM alias a
         LEFT JOIN domain d
           ON d.name = SUBSTRING_INDEX(a.address, '@', -1)
         WHERE a.address = ?
         FOR UPDATE`,
        [address]
      );

      if (rows.length === 1) {
        return { ok: false, created: false, alreadyExists: true, row: rows[0] };
      }

      const act = active ? 1 : 0;

      const result = await conn.query(
        `INSERT INTO alias (address, goto, active, created, modified)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`,
        [address, goto, act]
      );

      return { ok: true, created: true, insertId: result?.insertId ?? null };
    });
  },

  /**
   * List aliases by destination (goto).
   * @param {string} goto
   * @param {{ limit?: number, offset?: number }} [options]
   * @returns {Promise<object[]>}
   */
  async listByGoto(goto, options = {}) {
    if (!goto || typeof goto !== "string") throw new Error("invalid_goto");
    const limit = Number(options.limit);
    const offset = Number(options.offset);
    const hasLimit = Number.isInteger(limit) && limit > 0;
    const safeOffset = Number.isInteger(offset) && offset >= 0 ? offset : 0;

    const normalizedGoto = goto.trim().toLowerCase();
    const sqlBase = `SELECT a.id, a.address, a.goto, a.active, d.id AS domain_id, a.created, a.modified
       FROM alias a
       LEFT JOIN domain d
         ON d.name = SUBSTRING_INDEX(a.address, '@', -1)
       WHERE a.goto = ?
       ORDER BY a.id DESC`;
    const rows = hasLimit
      ? await query(`${sqlBase} LIMIT ? OFFSET ?`, [normalizedGoto, limit, safeOffset])
      : await query(sqlBase, [normalizedGoto]);

    return rows;
  },

  /**
   * Count aliases by destination (goto).
   * @param {string} goto
   * @returns {Promise<number>}
   */
  async countByGoto(goto) {
    if (!goto || typeof goto !== "string") throw new Error("invalid_goto");
    const rows = await query(
      `SELECT COUNT(*) AS total
       FROM alias
       WHERE goto = ?`,
      [goto.trim().toLowerCase()]
    );
    return Number(rows[0]?.total ?? 0);
  },

  /**
   * Build alias stats by destination (goto).
   * @param {string} goto
   * @returns {Promise<{ totals: number, active: number, created_last_7d: number, modified_last_24h: number, by_domain: Array<{ domain: string, total: number, active: number }> }>}
   */
  async getStatsByGoto(goto) {
    if (!goto || typeof goto !== "string") throw new Error("invalid_goto");
    const normalizedGoto = goto.trim().toLowerCase();

    const totalsRows = await query(
      `SELECT
          COUNT(*) AS totals,
          SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN created >= NOW() - INTERVAL 7 DAY THEN 1 ELSE 0 END) AS created_last_7d,
          SUM(CASE WHEN modified >= NOW() - INTERVAL 24 HOUR THEN 1 ELSE 0 END) AS modified_last_24h
       FROM alias
       WHERE goto = ?`,
      [normalizedGoto]
    );

    const domainsRows = await query(
      `SELECT
          SUBSTRING_INDEX(address, '@', -1) AS domain,
          COUNT(*) AS total,
          SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) AS active
       FROM alias
       WHERE goto = ?
       GROUP BY domain
       ORDER BY total DESC, domain ASC`,
      [normalizedGoto]
    );

    const totals = totalsRows[0] || {};

    return {
      totals: Number(totals.totals ?? 0),
      active: Number(totals.active ?? 0),
      created_last_7d: Number(totals.created_last_7d ?? 0),
      modified_last_24h: Number(totals.modified_last_24h ?? 0),
      by_domain: domainsRows.map((row) => ({
        domain: String(row.domain || ""),
        total: Number(row.total ?? 0),
        active: Number(row.active ?? 0),
      })),
    };
  },

  /**
   * List aliases with optional filters.
   * @param {{ limit: number, offset: number, active?: number, goto?: string, domain?: string, address?: string, handle?: string }} options
   * @returns {Promise<object[]>}
   */
  async listAll({ limit, offset, active, goto, domain, address, handle }) {
    const where = [];
    const params = [];

    if (active === 0 || active === 1) {
      where.push("a.active = ?");
      params.push(active);
    }
    if (goto) {
      where.push("a.goto = ?");
      params.push(goto);
    }
    if (domain) {
      where.push("SUBSTRING_INDEX(a.address, '@', -1) = ?");
      params.push(domain);
    }
    if (handle) {
      where.push("SUBSTRING_INDEX(a.address, '@', 1) = ?");
      params.push(handle);
    }
    if (address) {
      where.push("a.address = ?");
      params.push(address);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await query(
      `SELECT a.id, a.address, a.goto, a.active, d.id AS domain_id, a.created, a.modified
       FROM alias a
       LEFT JOIN domain d
         ON d.name = SUBSTRING_INDEX(a.address, '@', -1)
       ${whereSql}
       ORDER BY a.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return rows;
  },

  /**
   * Count aliases with optional filters.
   * @param {{ active?: number, goto?: string, domain?: string, address?: string, handle?: string }} options
   * @returns {Promise<number>}
   */
  async countAll({ active, goto, domain, address, handle }) {
    const where = [];
    const params = [];

    if (active === 0 || active === 1) {
      where.push("active = ?");
      params.push(active);
    }
    if (goto) {
      where.push("goto = ?");
      params.push(goto);
    }
    if (domain) {
      where.push("SUBSTRING_INDEX(address, '@', -1) = ?");
      params.push(domain);
    }
    if (handle) {
      where.push("SUBSTRING_INDEX(address, '@', 1) = ?");
      params.push(handle);
    }
    if (address) {
      where.push("address = ?");
      params.push(address);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    const rows = await query(
      `SELECT COUNT(*) AS total
       FROM alias
       ${whereSql}`,
      params
    );

    return Number(rows[0]?.total ?? 0);
  },

  /**
   * Update alias fields by id.
   * @param {number} id
   * @param {{ address?: string, goto?: string, active?: number }} patch
   * @returns {Promise<boolean>}
   */
  async updateById(id, patch) {
    const updates = [];
    const params = [];

    if (patch.address !== undefined) {
      updates.push("address = ?");
      params.push(patch.address);
    }
    if (patch.goto !== undefined) {
      updates.push("goto = ?");
      params.push(patch.goto);
    }
    if (patch.active === 0 || patch.active === 1) {
      updates.push("active = ?");
      params.push(patch.active);
    }
    if (updates.length === 0) return false;

    updates.push("modified = CURRENT_TIMESTAMP()");

    const result = await query(
      `UPDATE alias
       SET ${updates.join(", ")}
       WHERE id = ?
       LIMIT 1`,
      [...params, id]
    );

    return Boolean(result && result.affectedRows === 1);
  },

  /**
   * Soft-delete alias (active=0).
   * @param {number} id
   * @returns {Promise<boolean>}
   */
  async disableById(id) {
    const result = await query(
      `UPDATE alias
       SET active = 0,
           modified = CURRENT_TIMESTAMP()
       WHERE id = ?
       LIMIT 1`,
      [id]
    );
    return Boolean(result && result.affectedRows === 1);
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
