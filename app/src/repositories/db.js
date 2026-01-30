"use strict";

/**
 * @fileoverview MariaDB connection pool and query helpers.
 */

const mariadb = require("mariadb");
const { config } = require("../config");
const { logger } = require("../lib/logger");

let pool = null;

/**
 * Lazily create and return the shared MariaDB pool.
 * @returns {import("mariadb").Pool}
 */
function getPool() {
  if (pool) return pool;

  pool = mariadb.createPool({
    host: config.mariadbHost,
    port: config.mariadbPort,
    user: config.mariadbUser,
    password: config.mariadbPassword,
    database: config.mariadbDatabase,
    connectionLimit: 10,
  });

  logger.info("db.pool.created", {
    host: config.mariadbHost,
    port: config.mariadbPort,
    database: config.mariadbDatabase,
    user: config.mariadbUser,
    connectionLimit: 10,
  });

  return pool;
}

/**
 * Execute a parameterized query using the shared pool.
 * @param {string} sql
 * @param {unknown[]} params
 * @returns {Promise<unknown>}
 */
async function query(sql, params = []) {
  const poolRef = getPool();
  let conn;
  try {
    conn = await poolRef.getConnection();
    return await conn.query(sql, params);
  } catch (err) {
    logger.error("db.query.error", {
      err,
      sql,
      params_count: Array.isArray(params) ? params.length : 0,
    });
    throw err;
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Execute work within a database transaction.
 * @param {(conn: import("mariadb").PoolConnection) => Promise<unknown>} fn
 * @returns {Promise<unknown>}
 */
async function withTransaction(fn) {
  const poolRef = getPool();
  let conn;
  try {
    conn = await poolRef.getConnection();
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (err) {
    try {
      if (conn) await conn.rollback();
    } catch (_) {}
    throw err;
  } finally {
    if (conn) conn.release();
  }
}

module.exports = {
  getPool,
  query,
  withTx: withTransaction,
  withTransaction,
};
