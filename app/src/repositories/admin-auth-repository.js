"use strict";

/**
 * @fileoverview Shared user and auth-session repository.
 */

const crypto = require("crypto");
const { query, withTx } = require("./db");
const {
  normalizeEmailStrict,
  normalizeUsername,
} = require("../lib/auth-identifiers");

const USERS_TABLE = "users";
const SESSIONS_TABLE = "auth_sessions";
const SESSION_STATUS_ACTIVE = "active";
const SESSION_STATUS_ROTATED = "rotated";
const SESSION_STATUS_REVOKED = "revoked";
const SESSION_STATUS_REUSE_DETECTED = "reuse_detected";

const USER_SELECT_COLUMNS = `
  id,
  username,
  email,
  password_hash,
  email_verified_at,
  is_active,
  is_admin,
  password_changed_at,
  created_at,
  updated_at,
  last_login_at
`;

const DEFAULT_RETRY_MAX = 2;
const RETRY_MIN_DELAY_MS = 25;
const RETRY_MAX_DELAY_MS = 120;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableTxError(err) {
  if (!err) return false;
  const code = String(err.code || "");
  const errno = Number(err.errno);
  return (
    code === "ER_LOCK_DEADLOCK" ||
    code === "ER_LOCK_WAIT_TIMEOUT" ||
    errno === 1213 ||
    errno === 1205
  );
}

function randomIntBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function assertUserId(value) {
  const userId = Number(value);
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("invalid_user_id");
  return userId;
}

function assertSessionFamilyId(value) {
  const sessionFamilyId = String(value || "").trim();
  if (!sessionFamilyId || sessionFamilyId.length > 64) {
    throw new Error("invalid_session_family_id");
  }
  return sessionFamilyId;
}

function assertTokenHash32(buf) {
  if (!Buffer.isBuffer(buf) || buf.length !== 32) throw new Error("invalid_token_hash");
}

function assertRefreshTtlDays(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0 || num > 365) {
    throw new Error("invalid_refresh_ttl_days");
  }
  return Math.floor(num);
}

function assertEmail(value) {
  const email = normalizeEmailStrict(value);
  if (!email) throw new Error("invalid_email");
  return email;
}

function assertUsername(value) {
  const username = normalizeUsername(value);
  if (!username) throw new Error("invalid_username");
  return username;
}

function assertPasswordHash(value) {
  const passwordHash = String(value || "").trim();
  if (!passwordHash || passwordHash.length > 255) throw new Error("invalid_password_hash");
  return passwordHash;
}

function normalizeOptionalDatetime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function buildContainsLikePattern(raw) {
  const normalized = String(raw || "").trim().toLowerCase();
  if (!normalized) return null;
  const escaped = normalized.replace(/[\\%_]/g, "\\$&");
  return `%${escaped}%`;
}

function buildInPlaceholders(values) {
  return values.map(() => "?").join(", ");
}

async function withTxRetry(fn, opts = {}) {
  const maxRetries = Number.isFinite(opts.maxRetries) ? opts.maxRetries : DEFAULT_RETRY_MAX;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await withTx(fn);
    } catch (err) {
      if (!isRetryableTxError(err) || attempt >= maxRetries) {
        if (isRetryableTxError(err)) {
          const out = new Error("tx_busy");
          out.code = "tx_busy";
          out.cause = err;
          throw out;
        }
        throw err;
      }
      await sleep(randomIntBetween(RETRY_MIN_DELAY_MS, RETRY_MAX_DELAY_MS));
    }
  }
  throw new Error("tx_retry_exhausted");
}

async function selectUserByIdForUpdate(conn, id) {
  const rows = await conn.query(
    `SELECT ${USER_SELECT_COLUMNS}
     FROM ${USERS_TABLE}
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`,
    [id]
  );
  return rows[0] || null;
}

async function revokeSessionFamiliesByIdsTx(conn, familyIds, status = SESSION_STATUS_REVOKED) {
  const normalized = Array.from(
    new Set(
      (familyIds || [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );

  if (normalized.length === 0) return 0;

  const result = await conn.query(
    `UPDATE ${SESSIONS_TABLE}
     SET status = ?,
         revoked_at = COALESCE(revoked_at, NOW(6))
     WHERE session_family_id IN (${buildInPlaceholders(normalized)})
       AND status IN (?, ?)`,
    [status, ...normalized, SESSION_STATUS_ACTIVE, SESSION_STATUS_ROTATED]
  );

  return Number(result?.affectedRows ?? 0);
}

async function markRotatedTokenReuseTx(conn, sessionRow) {
  const sessionId = Number(sessionRow?.id || 0);
  const sessionFamilyId = String(sessionRow?.session_family_id || "").trim();
  if (!sessionId || !sessionFamilyId) return 0;

  await conn.query(
    `UPDATE ${SESSIONS_TABLE}
     SET status = ?,
         revoked_at = COALESCE(revoked_at, NOW(6))
     WHERE id = ?
     LIMIT 1`,
    [SESSION_STATUS_REUSE_DETECTED, sessionId]
  );

  return revokeSessionFamiliesByIdsTx(conn, [sessionFamilyId], SESSION_STATUS_REVOKED);
}

const adminAuthRepository = {
  /**
   * @param {number} id
   * @returns {Promise<object | null>}
   */
  async getUserById(id) {
    const rows = await query(
      `SELECT ${USER_SELECT_COLUMNS}
       FROM ${USERS_TABLE}
       WHERE id = ?
       LIMIT 1`,
      [id]
    );

    return rows[0] || null;
  },

  /**
   * @param {string} email
   * @returns {Promise<object | null>}
   */
  async getUserByEmail(email) {
    const normalizedEmail = assertEmail(email);
    const rows = await query(
      `SELECT ${USER_SELECT_COLUMNS}
       FROM ${USERS_TABLE}
       WHERE email = ?
       LIMIT 1`,
      [normalizedEmail]
    );

    return rows[0] || null;
  },

  /**
   * @param {string} username
   * @returns {Promise<object | null>}
   */
  async getUserByUsername(username) {
    const normalizedUsername = assertUsername(username);
    const rows = await query(
      `SELECT ${USER_SELECT_COLUMNS}
       FROM ${USERS_TABLE}
       WHERE username = ?
       LIMIT 1`,
      [normalizedUsername]
    );

    return rows[0] || null;
  },

  /**
   * @param {{ type: "email" | "username", value: string }} identifier
   * @returns {Promise<object | null>}
   */
  async getActiveUserByIdentifier(identifier) {
    if (!identifier || !identifier.type || !identifier.value) return null;
    const field = identifier.type === "email" ? "email" : "username";
    const value = identifier.type === "email" ? assertEmail(identifier.value) : assertUsername(identifier.value);

    const rows = await query(
      `SELECT ${USER_SELECT_COLUMNS}
       FROM ${USERS_TABLE}
       WHERE ${field} = ?
         AND is_active = 1
       LIMIT 1`,
      [value]
    );

    return rows[0] || null;
  },

  /**
   * @param {string} email
   * @returns {Promise<object | null>}
   */
  async getActiveUserByEmail(email) {
    const normalizedEmail = assertEmail(email);
    const rows = await query(
      `SELECT ${USER_SELECT_COLUMNS}
       FROM ${USERS_TABLE}
       WHERE email = ?
         AND is_active = 1
       LIMIT 1`,
      [normalizedEmail]
    );

    return rows[0] || null;
  },

  /**
   * @param {{ limit: number, offset: number, active?: number, email?: string, isAdmin?: number }} options
   * @returns {Promise<object[]>}
   */
  async listUsers({ limit, offset, active, email, isAdmin }) {
    const where = [];
    const params = [];

    if (active === 0 || active === 1) {
      where.push("is_active = ?");
      params.push(active);
    }
    if (isAdmin === 0 || isAdmin === 1) {
      where.push("is_admin = ?");
      params.push(isAdmin);
    }

    const emailPattern = buildContainsLikePattern(email);
    if (emailPattern) {
      where.push("email LIKE ? ESCAPE '\\\\'");
      params.push(emailPattern);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    return query(
      `SELECT ${USER_SELECT_COLUMNS}
       FROM ${USERS_TABLE}
       ${whereSql}
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
  },

  /**
   * @param {{ active?: number, email?: string, isAdmin?: number }} options
   * @returns {Promise<number>}
   */
  async countUsers({ active, email, isAdmin }) {
    const where = [];
    const params = [];

    if (active === 0 || active === 1) {
      where.push("is_active = ?");
      params.push(active);
    }
    if (isAdmin === 0 || isAdmin === 1) {
      where.push("is_admin = ?");
      params.push(isAdmin);
    }

    const emailPattern = buildContainsLikePattern(email);
    if (emailPattern) {
      where.push("email LIKE ? ESCAPE '\\\\'");
      params.push(emailPattern);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const rows = await query(
      `SELECT COUNT(*) AS total
       FROM ${USERS_TABLE}
       ${whereSql}`,
      params
    );

    return Number(rows[0]?.total ?? 0);
  },

  /**
   * @returns {Promise<number>}
   */
  async countActiveAdmins() {
    return adminAuthRepository.countUsers({ active: 1, isAdmin: 1 });
  },

  /**
   * @param {{ email: string, username: string, passwordHash: string, isActive?: number, isAdmin?: number, emailVerifiedAt?: Date | string | null }} payload
   * @returns {Promise<{ ok: boolean, insertId: number | null }>}
   */
  async createUser({
    email,
    username,
    passwordHash,
    isActive = 1,
    isAdmin = 0,
    emailVerifiedAt = null,
  }) {
    const normalizedEmail = assertEmail(email);
    const normalizedUsername = assertUsername(username);
    const normalizedPasswordHash = assertPasswordHash(passwordHash);

    const result = await query(
      `INSERT INTO ${USERS_TABLE} (
        username,
        email,
        password_hash,
        email_verified_at,
        is_active,
        is_admin,
        password_changed_at,
        created_at,
        updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, NOW(6), NOW(6), NOW(6)
      )`,
      [
        normalizedUsername,
        normalizedEmail,
        normalizedPasswordHash,
        emailVerifiedAt ? new Date(emailVerifiedAt) : null,
        isActive ? 1 : 0,
        isAdmin ? 1 : 0,
      ]
    );

    return {
      ok: Boolean(result && result.affectedRows === 1),
      insertId: result?.insertId ?? null,
    };
  },

  /**
   * @param {number} id
   * @param {{ email?: string, username?: string, passwordHash?: string, isActive?: number, isAdmin?: number, emailVerifiedAt?: Date | string | null, passwordChangedAt?: Date | string | null }} patch
   * @returns {Promise<boolean>}
   */
  async updateUserById(id, patch) {
    const updates = [];
    const params = [];

    if (patch.username !== undefined) {
      updates.push("username = ?");
      params.push(assertUsername(patch.username));
    }
    if (patch.email !== undefined) {
      updates.push("email = ?");
      params.push(assertEmail(patch.email));
    }
    if (patch.passwordHash !== undefined) {
      updates.push("password_hash = ?");
      params.push(assertPasswordHash(patch.passwordHash));
      updates.push("password_changed_at = NOW(6)");
    }
    if (patch.emailVerifiedAt !== undefined) {
      updates.push("email_verified_at = ?");
      params.push(normalizeOptionalDatetime(patch.emailVerifiedAt));
    }
    if (patch.passwordChangedAt !== undefined) {
      updates.push("password_changed_at = ?");
      params.push(normalizeOptionalDatetime(patch.passwordChangedAt));
    }
    if (patch.isActive === 0 || patch.isActive === 1) {
      updates.push("is_active = ?");
      params.push(patch.isActive);
    }
    if (patch.isAdmin === 0 || patch.isAdmin === 1) {
      updates.push("is_admin = ?");
      params.push(patch.isAdmin);
    }
    if (updates.length === 0) return false;

    updates.push("updated_at = NOW(6)");

    const result = await query(
      `UPDATE ${USERS_TABLE}
       SET ${updates.join(", ")}
       WHERE id = ?
       LIMIT 1`,
      [...params, id]
    );

    return Boolean(result && result.affectedRows === 1);
  },

  /**
   * @param {number} id
   * @returns {Promise<boolean>}
   */
  async disableUserById(id) {
    const result = await query(
      `UPDATE ${USERS_TABLE}
       SET is_active = 0,
           updated_at = NOW(6)
       WHERE id = ?
       LIMIT 1`,
      [id]
    );
    return Boolean(result && result.affectedRows === 1);
  },

  /**
   * @param {number} userId
   * @returns {Promise<boolean>}
   */
  async updateLastLoginAtById(userId) {
    const result = await query(
      `UPDATE ${USERS_TABLE}
       SET last_login_at = NOW(6)
       WHERE id = ?
       LIMIT 1`,
      [userId]
    );
    return Boolean(result && result.affectedRows === 1);
  },

  /**
   * @param {{ userId: number, refreshTokenHash32: Buffer, refreshTtlDays: number, requestIpPacked?: Buffer | null, userAgentOrNull?: string | null, maxActiveFamilies?: number }} payload
   * @returns {Promise<{ ok: boolean, sessionId: number | null, sessionFamilyId: string, refreshExpiresAt: Date | null, evictedFamilyIds: string[] }>}
   */
  async createSessionFamilyTx({
    userId,
    refreshTokenHash32,
    refreshTtlDays,
    requestIpPacked = null,
    userAgentOrNull = null,
    maxActiveFamilies = 5,
  }) {
    const normalizedUserId = assertUserId(userId);
    assertTokenHash32(refreshTokenHash32);
    const ttlDays = assertRefreshTtlDays(refreshTtlDays);
    const limitFamilies = Number.isFinite(Number(maxActiveFamilies))
      ? Math.max(1, Math.floor(Number(maxActiveFamilies)))
      : 5;

    return withTxRetry(async (conn) => {
      const user = await selectUserByIdForUpdate(conn, normalizedUserId);
      if (!user || Number(user.is_active || 0) !== 1) {
        return {
          ok: false,
          sessionId: null,
          sessionFamilyId: "",
          refreshExpiresAt: null,
          evictedFamilyIds: [],
        };
      }

      const activeFamilyRows = await conn.query(
        `SELECT session_family_id
         FROM ${SESSIONS_TABLE}
         WHERE user_id = ?
         GROUP BY session_family_id
         HAVING SUM(
           CASE
             WHEN status = ?
              AND revoked_at IS NULL
              AND refresh_expires_at > NOW(6)
             THEN 1 ELSE 0
           END
         ) > 0
         ORDER BY MIN(created_at) ASC`,
        [normalizedUserId, SESSION_STATUS_ACTIVE]
      );

      const evictedFamilyIds = [];
      const overflow = Math.max(0, activeFamilyRows.length - limitFamilies + 1);
      if (overflow > 0) {
        for (const row of activeFamilyRows.slice(0, overflow)) {
          const familyId = String(row.session_family_id || "").trim();
          if (familyId) evictedFamilyIds.push(familyId);
        }
        await revokeSessionFamiliesByIdsTx(conn, evictedFamilyIds, SESSION_STATUS_REVOKED);
      }

      const sessionFamilyId = crypto.randomUUID();
      const result = await conn.query(
        `INSERT INTO ${SESSIONS_TABLE} (
          user_id,
          session_family_id,
          refresh_token_hash,
          refresh_expires_at,
          status,
          revoked_at,
          replaced_by_session_id,
          created_at,
          last_used_at,
          request_ip,
          user_agent
        ) VALUES (
          ?, ?, ?, DATE_ADD(NOW(6), INTERVAL ? DAY), ?, NULL, NULL, NOW(6), NOW(6), ?, ?
        )`,
        [
          normalizedUserId,
          sessionFamilyId,
          refreshTokenHash32,
          ttlDays,
          SESSION_STATUS_ACTIVE,
          requestIpPacked,
          userAgentOrNull || null,
        ]
      );

      const rows = await conn.query(
        `SELECT id, session_family_id, refresh_expires_at
         FROM ${SESSIONS_TABLE}
         WHERE id = ?
         LIMIT 1`,
        [result.insertId]
      );
      const row = rows[0] || null;

      return {
        ok: Boolean(result && result.affectedRows === 1),
        sessionId: row?.id ?? null,
        sessionFamilyId: String(row?.session_family_id || sessionFamilyId),
        refreshExpiresAt: row?.refresh_expires_at || null,
        evictedFamilyIds,
      };
    });
  },

  /**
   * @param {Buffer} refreshTokenHash32
   * @returns {Promise<object | null>}
   */
  async getSessionByRefreshTokenHash(refreshTokenHash32) {
    assertTokenHash32(refreshTokenHash32);

    const rows = await query(
      `SELECT
          s.id,
          s.user_id,
          s.session_family_id,
          s.refresh_expires_at,
          s.status,
          s.revoked_at,
          s.replaced_by_session_id,
          s.created_at,
          s.last_used_at,
          u.username,
          u.email,
          u.email_verified_at,
          u.is_active,
          u.is_admin,
          u.password_changed_at
       FROM ${SESSIONS_TABLE} s
       INNER JOIN ${USERS_TABLE} u ON u.id = s.user_id
       WHERE s.refresh_token_hash = ?
       ORDER BY s.id DESC
       LIMIT 1`,
      [refreshTokenHash32]
    );

    return rows[0] || null;
  },

  /**
   * @param {Buffer} refreshTokenHash32
   * @returns {Promise<object | null>}
   */
  async getActiveSessionByRefreshTokenHash(refreshTokenHash32) {
    assertTokenHash32(refreshTokenHash32);

    const rows = await query(
      `SELECT
          s.id,
          s.user_id,
          s.session_family_id,
          s.refresh_expires_at,
          s.status,
          s.revoked_at,
          s.replaced_by_session_id,
          s.created_at,
          s.last_used_at,
          u.username,
          u.email,
          u.email_verified_at,
          u.is_active,
          u.is_admin,
          u.password_changed_at
       FROM ${SESSIONS_TABLE} s
       INNER JOIN ${USERS_TABLE} u ON u.id = s.user_id
       WHERE s.refresh_token_hash = ?
         AND s.status = ?
         AND s.revoked_at IS NULL
         AND s.refresh_expires_at > NOW(6)
         AND u.is_active = 1
       ORDER BY s.id DESC
       LIMIT 1`,
      [refreshTokenHash32, SESSION_STATUS_ACTIVE]
    );

    return rows[0] || null;
  },

  /**
   * @param {{ sessionFamilyId: string, userId?: number | string | null }} payload
   * @returns {Promise<object | null>}
   */
  async getActiveSessionFamily({ sessionFamilyId, userId = null }) {
    const normalizedFamilyId = assertSessionFamilyId(sessionFamilyId);
    const params = [normalizedFamilyId, SESSION_STATUS_ACTIVE];
    let userSql = "";

    if (userId !== null && userId !== undefined && String(userId).trim()) {
      userSql = "AND s.user_id = ?";
      params.push(Number(userId));
    }

    const rows = await query(
      `SELECT
          s.id,
          s.user_id,
          s.session_family_id,
          s.refresh_expires_at,
          s.status,
          s.revoked_at,
          s.replaced_by_session_id,
          s.created_at,
          s.last_used_at,
          u.username,
          u.email,
          u.email_verified_at,
          u.is_active,
          u.is_admin,
          u.password_changed_at
       FROM ${SESSIONS_TABLE} s
       INNER JOIN ${USERS_TABLE} u ON u.id = s.user_id
       WHERE s.session_family_id = ?
         AND s.status = ?
         AND s.revoked_at IS NULL
         AND s.refresh_expires_at > NOW(6)
         ${userSql}
         AND u.is_active = 1
       ORDER BY s.id DESC
       LIMIT 1`,
      params
    );

    return rows[0] || null;
  },

  /**
   * @param {{ presentedRefreshTokenHash32: Buffer, nextRefreshTokenHash32: Buffer, requestIpPacked?: Buffer | null, userAgentOrNull?: string | null }} payload
   * @returns {Promise<{ ok: boolean, reason?: string, sessionFamilyId?: string, userId?: number, refreshExpiresAt?: Date | null, sessionId?: number | null }>}
   */
  async rotateRefreshSessionTx({
    presentedRefreshTokenHash32,
    nextRefreshTokenHash32,
    requestIpPacked = null,
    userAgentOrNull = null,
  }) {
    assertTokenHash32(presentedRefreshTokenHash32);
    assertTokenHash32(nextRefreshTokenHash32);

    return withTxRetry(async (conn) => {
      const rows = await conn.query(
        `SELECT *
         FROM ${SESSIONS_TABLE}
         WHERE refresh_token_hash = ?
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`,
        [presentedRefreshTokenHash32]
      );
      const current = rows[0] || null;

      if (!current) return { ok: false, reason: "invalid_or_expired" };

      const user = await selectUserByIdForUpdate(conn, current.user_id);
      if (!user || Number(user.is_active || 0) !== 1) {
        await revokeSessionFamiliesByIdsTx(conn, [current.session_family_id], SESSION_STATUS_REVOKED);
        return { ok: false, reason: "invalid_or_expired" };
      }

      const isExpired = new Date(current.refresh_expires_at).getTime() <= Date.now();
      if (current.status === SESSION_STATUS_ROTATED) {
        await markRotatedTokenReuseTx(conn, current);
        return { ok: false, reason: "reuse_detected" };
      }

      if (
        current.status !== SESSION_STATUS_ACTIVE ||
        current.revoked_at ||
        isExpired
      ) {
        return { ok: false, reason: "invalid_or_expired" };
      }

      const result = await conn.query(
        `INSERT INTO ${SESSIONS_TABLE} (
          user_id,
          session_family_id,
          refresh_token_hash,
          refresh_expires_at,
          status,
          revoked_at,
          replaced_by_session_id,
          created_at,
          last_used_at,
          request_ip,
          user_agent
        ) VALUES (
          ?, ?, ?, ?, ?, NULL, NULL, NOW(6), NOW(6), ?, ?
        )`,
        [
          current.user_id,
          current.session_family_id,
          nextRefreshTokenHash32,
          current.refresh_expires_at,
          SESSION_STATUS_ACTIVE,
          requestIpPacked,
          userAgentOrNull || null,
        ]
      );

      await conn.query(
        `UPDATE ${SESSIONS_TABLE}
         SET status = ?,
             replaced_by_session_id = ?,
             last_used_at = NOW(6)
         WHERE id = ?
         LIMIT 1`,
        [SESSION_STATUS_ROTATED, result.insertId, current.id]
      );

      const freshRows = await conn.query(
        `SELECT id, user_id, session_family_id, refresh_expires_at
         FROM ${SESSIONS_TABLE}
         WHERE id = ?
         LIMIT 1`,
        [result.insertId]
      );
      const fresh = freshRows[0] || null;

      return {
        ok: true,
        sessionId: fresh?.id ?? null,
        userId: Number(fresh?.user_id ?? current.user_id),
        sessionFamilyId: String(fresh?.session_family_id || current.session_family_id || ""),
        refreshExpiresAt: fresh?.refresh_expires_at || current.refresh_expires_at || null,
      };
    });
  },

  /**
   * @param {string} sessionFamilyId
   * @returns {Promise<boolean>}
   */
  async touchSessionFamilyLastUsed(sessionFamilyId) {
    const normalizedFamilyId = assertSessionFamilyId(sessionFamilyId);
    const result = await query(
      `UPDATE ${SESSIONS_TABLE}
       SET last_used_at = NOW(6)
       WHERE session_family_id = ?
         AND status = ?
         AND revoked_at IS NULL`,
      [normalizedFamilyId, SESSION_STATUS_ACTIVE]
    );
    return Boolean(result && result.affectedRows >= 1);
  },

  /**
   * @param {string} sessionFamilyId
   * @returns {Promise<number>}
   */
  async revokeSessionFamilyById(sessionFamilyId) {
    const normalizedFamilyId = assertSessionFamilyId(sessionFamilyId);
    const result = await query(
      `UPDATE ${SESSIONS_TABLE}
       SET status = ?,
           revoked_at = COALESCE(revoked_at, NOW(6))
       WHERE session_family_id = ?
         AND status IN (?, ?)`,
      [
        SESSION_STATUS_REVOKED,
        normalizedFamilyId,
        SESSION_STATUS_ACTIVE,
        SESSION_STATUS_ROTATED,
      ]
    );
    return Number(result?.affectedRows ?? 0);
  },

  /**
   * Revoke all active session families for a user.
   * @param {number} userId
   * @param {{ exceptSessionFamilyId?: string }} [options]
   * @returns {Promise<number>}
   */
  async revokeSessionsByUserId(userId, options = {}) {
    const normalizedUserId = assertUserId(userId);
    const exceptSessionFamilyId = options.exceptSessionFamilyId
      ? assertSessionFamilyId(options.exceptSessionFamilyId)
      : null;

    const params = [SESSION_STATUS_REVOKED, normalizedUserId];
    let exceptSql = "";
    if (exceptSessionFamilyId) {
      exceptSql = "AND session_family_id <> ?";
      params.push(exceptSessionFamilyId);
    }

    const result = await query(
      `UPDATE ${SESSIONS_TABLE}
       SET status = ?,
           revoked_at = COALESCE(revoked_at, NOW(6))
       WHERE user_id = ?
         ${exceptSql}
         AND status IN (?, ?)`,
      [...params, SESSION_STATUS_ACTIVE, SESSION_STATUS_ROTATED]
    );

    return Number(result?.affectedRows ?? 0);
  },
};

module.exports = { adminAuthRepository };
