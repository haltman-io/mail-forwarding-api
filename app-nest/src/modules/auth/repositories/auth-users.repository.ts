import crypto from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { PoolConnection } from "mariadb";

import { DatabaseService } from "../../../shared/database/database.service.js";
import {
  normalizeEmailStrict,
  normalizeUsername,
  type ParsedIdentifier,
} from "../../../shared/utils/auth-identifiers.js";

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

interface InsertResult {
  affectedRows: number;
  insertId: number | bigint;
}

interface SessionInsertRow {
  id: number;
  session_family_id: string;
  refresh_expires_at: Date | string | null;
  user_id?: number;
}

interface StoredSessionRow extends AuthSessionRow {
  status: string;
  revoked_at: Date | string | null;
  replaced_by_session_id: number | null;
  created_at: Date | string;
  last_used_at: Date | string;
}

export interface AuthUserRow {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  email_verified_at: Date | string | null;
  is_active: number;
  is_admin: number;
  password_changed_at: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  last_login_at: Date | string | null;
}

export interface AuthSessionRow {
  id: number;
  user_id: number;
  session_family_id: string;
  refresh_expires_at: Date | string | null;
  username: string;
  email: string;
  email_verified_at: Date | string | null;
  is_active: number;
  is_admin: number;
  password_changed_at: Date | string | null;
}

export interface CreateSessionFamilyResult {
  ok: boolean;
  sessionId: number | null;
  sessionFamilyId: string;
  refreshExpiresAt: Date | string | null;
  evictedFamilyIds: string[];
}

export interface RotateRefreshSessionResult {
  ok: boolean;
  reason?: string;
  sessionFamilyId?: string;
  userId?: number;
  refreshExpiresAt?: Date | string | null;
  sessionId?: number | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableTxError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; errno?: number };
  const code = String(e.code || "");
  const errno = Number(e.errno);
  return (
    code === "ER_LOCK_DEADLOCK" ||
    code === "ER_LOCK_WAIT_TIMEOUT" ||
    errno === 1213 ||
    errno === 1205
  );
}

function randomIntBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function assertUserId(value: unknown): number {
  const userId = Number(value);
  if (!Number.isInteger(userId) || userId <= 0) throw new Error("invalid_user_id");
  return userId;
}

function assertSessionFamilyId(value: unknown): string {
  const sessionFamilyId = typeof value === "string" ? value.trim() : "";
  if (!sessionFamilyId || sessionFamilyId.length > 64) {
    throw new Error("invalid_session_family_id");
  }
  return sessionFamilyId;
}

function assertTokenHash32(buf: Buffer): Buffer {
  if (!Buffer.isBuffer(buf) || buf.length !== 32) throw new Error("invalid_token_hash");
  return buf;
}

function assertRefreshTtlDays(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0 || num > 365) {
    throw new Error("invalid_refresh_ttl_days");
  }
  return Math.floor(num);
}

function assertEmail(value: unknown): string {
  const email = normalizeEmailStrict(value);
  if (!email) throw new Error("invalid_email");
  return email;
}

function assertUsername(value: unknown): string {
  const username = normalizeUsername(value);
  if (!username) throw new Error("invalid_username");
  return username;
}

function assertPasswordHash(value: unknown): string {
  const passwordHash = typeof value === "string" ? value.trim() : "";
  if (!passwordHash || passwordHash.length > 255) throw new Error("invalid_password_hash");
  return passwordHash;
}

async function withTxRetry<T>(
  database: DatabaseService,
  work: (connection: PoolConnection) => Promise<T>,
  opts: { maxRetries?: number } = {},
): Promise<T> {
  const maxRetries = Number.isFinite(opts.maxRetries)
    ? Number(opts.maxRetries)
    : DEFAULT_RETRY_MAX;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await database.withTransaction(work);
    } catch (err) {
      if (!isRetryableTxError(err) || attempt >= maxRetries) {
        if (isRetryableTxError(err)) {
          const out = new Error("tx_busy") as Error & { code: string; cause: unknown };
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

async function selectUserByIdForUpdate(
  conn: PoolConnection,
  id: number,
): Promise<AuthUserRow | null> {
  const rows = await conn.query<AuthUserRow[]>(
    `SELECT ${USER_SELECT_COLUMNS}
     FROM ${USERS_TABLE}
     WHERE id = ?
     LIMIT 1
     FOR UPDATE`,
    [id],
  );
  return rows[0] ?? null;
}

async function revokeSessionFamiliesByIdsTx(
  conn: PoolConnection,
  familyIds: string[],
  status = SESSION_STATUS_REVOKED,
): Promise<number> {
  const normalized = Array.from(
    new Set((familyIds || []).map((value) => String(value || "").trim()).filter(Boolean)),
  );
  if (normalized.length === 0) return 0;

  const placeholders = normalized.map(() => "?").join(", ");
  const result = await conn.query<InsertResult>(
    `UPDATE ${SESSIONS_TABLE}
     SET status = ?,
         revoked_at = COALESCE(revoked_at, NOW(6))
     WHERE session_family_id IN (${placeholders})
       AND status IN (?, ?)`,
    [status, ...normalized, SESSION_STATUS_ACTIVE, SESSION_STATUS_ROTATED],
  );

  return Number(result?.affectedRows ?? 0);
}

async function markRotatedTokenReuseTx(
  conn: PoolConnection,
  sessionRow: StoredSessionRow | null,
): Promise<number> {
  const sessionId = Number(sessionRow?.id || 0);
  const sessionFamilyId = String(sessionRow?.session_family_id || "").trim();
  if (!sessionId || !sessionFamilyId) return 0;

  await conn.query(
    `UPDATE ${SESSIONS_TABLE}
     SET status = ?,
         revoked_at = COALESCE(revoked_at, NOW(6))
     WHERE id = ?
     LIMIT 1`,
    [SESSION_STATUS_REUSE_DETECTED, sessionId],
  );

  return revokeSessionFamiliesByIdsTx(conn, [sessionFamilyId], SESSION_STATUS_REVOKED);
}

@Injectable()
export class AuthUsersRepository {
  constructor(private readonly database: DatabaseService) {}

  async getUserById(id: number): Promise<AuthUserRow | null> {
    const rows = await this.database.query<AuthUserRow[]>(
      `SELECT ${USER_SELECT_COLUMNS}
       FROM ${USERS_TABLE}
       WHERE id = ?
       LIMIT 1`,
      [id],
    );

    return rows[0] ?? null;
  }

  async getUserByEmail(email: string): Promise<AuthUserRow | null> {
    const normalizedEmail = assertEmail(email);
    const rows = await this.database.query<AuthUserRow[]>(
      `SELECT ${USER_SELECT_COLUMNS}
       FROM ${USERS_TABLE}
       WHERE email = ?
       LIMIT 1`,
      [normalizedEmail],
    );

    return rows[0] ?? null;
  }

  async getUserByUsername(username: string): Promise<AuthUserRow | null> {
    const normalizedUsername = assertUsername(username);
    const rows = await this.database.query<AuthUserRow[]>(
      `SELECT ${USER_SELECT_COLUMNS}
       FROM ${USERS_TABLE}
       WHERE username = ?
       LIMIT 1`,
      [normalizedUsername],
    );

    return rows[0] ?? null;
  }

  async getActiveUserByIdentifier(
    identifier: ParsedIdentifier,
  ): Promise<AuthUserRow | null> {
    if (!identifier?.type || !identifier?.value) return null;

    const field = identifier.type === "email" ? "email" : "username";
    const value =
      identifier.type === "email"
        ? assertEmail(identifier.value)
        : assertUsername(identifier.value);

    const rows = await this.database.query<AuthUserRow[]>(
      `SELECT ${USER_SELECT_COLUMNS}
       FROM ${USERS_TABLE}
       WHERE ${field} = ?
         AND is_active = 1
       LIMIT 1`,
      [value],
    );

    return rows[0] ?? null;
  }

  async getActiveUserByEmail(email: string): Promise<AuthUserRow | null> {
    const normalizedEmail = assertEmail(email);
    const rows = await this.database.query<AuthUserRow[]>(
      `SELECT ${USER_SELECT_COLUMNS}
       FROM ${USERS_TABLE}
       WHERE email = ?
         AND is_active = 1
       LIMIT 1`,
      [normalizedEmail],
    );

    return rows[0] ?? null;
  }

  async createUser(payload: {
    email: string;
    username: string;
    passwordHash: string;
    isActive?: number;
    isAdmin?: number;
    emailVerifiedAt?: Date | string | null;
  }): Promise<{ ok: boolean; insertId: number | null }> {
    const normalizedEmail = assertEmail(payload.email);
    const normalizedUsername = assertUsername(payload.username);
    const normalizedPasswordHash = assertPasswordHash(payload.passwordHash);

    const result = await this.database.query<InsertResult>(
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
        payload.emailVerifiedAt ? new Date(payload.emailVerifiedAt) : null,
        payload.isActive ? 1 : 0,
        payload.isAdmin ? 1 : 0,
      ],
    );

    return {
      ok: Boolean(result?.affectedRows === 1),
      insertId: result?.insertId ? Number(result.insertId) : null,
    };
  }

  async updateLastLoginAtById(userId: number): Promise<boolean> {
    const result = await this.database.query<InsertResult>(
      `UPDATE ${USERS_TABLE}
       SET last_login_at = NOW(6)
       WHERE id = ?
       LIMIT 1`,
      [userId],
    );

    return Boolean(result?.affectedRows === 1);
  }

  async createSessionFamilyTx(payload: {
    userId: number;
    refreshTokenHash32: Buffer;
    refreshTtlDays: number;
    requestIpPacked?: Buffer | null;
    userAgentOrNull?: string | null;
    maxActiveFamilies?: number;
  }): Promise<CreateSessionFamilyResult> {
    const normalizedUserId = assertUserId(payload.userId);
    assertTokenHash32(payload.refreshTokenHash32);
    const ttlDays = assertRefreshTtlDays(payload.refreshTtlDays);
    const limitFamilies = Number.isFinite(Number(payload.maxActiveFamilies))
      ? Math.max(1, Math.floor(Number(payload.maxActiveFamilies)))
      : 5;

    return withTxRetry(this.database, async (conn) => {
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

      const activeFamilyRows = await conn.query<{ session_family_id: string }[]>(
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
        [normalizedUserId, SESSION_STATUS_ACTIVE],
      );

      const evictedFamilyIds: string[] = [];
      const overflow = Math.max(0, activeFamilyRows.length - limitFamilies + 1);
      if (overflow > 0) {
        for (const row of activeFamilyRows.slice(0, overflow)) {
          const familyId = String(row.session_family_id || "").trim();
          if (familyId) evictedFamilyIds.push(familyId);
        }
        await revokeSessionFamiliesByIdsTx(conn, evictedFamilyIds, SESSION_STATUS_REVOKED);
      }

      const sessionFamilyId = crypto.randomUUID();
      const result = await conn.query<InsertResult>(
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
          payload.refreshTokenHash32,
          ttlDays,
          SESSION_STATUS_ACTIVE,
          payload.requestIpPacked || null,
          payload.userAgentOrNull || null,
        ],
      );

      const rows = await conn.query<SessionInsertRow[]>(
        `SELECT id, session_family_id, refresh_expires_at
         FROM ${SESSIONS_TABLE}
         WHERE id = ?
         LIMIT 1`,
        [result.insertId],
      );
      const row = rows[0] ?? null;

      return {
        ok: Boolean(result?.affectedRows === 1),
        sessionId: row?.id ?? null,
        sessionFamilyId: String(row?.session_family_id || sessionFamilyId),
        refreshExpiresAt: row?.refresh_expires_at || null,
        evictedFamilyIds,
      };
    });
  }

  async getActiveSessionByRefreshTokenHash(
    refreshTokenHash32: Buffer,
  ): Promise<AuthSessionRow | null> {
    assertTokenHash32(refreshTokenHash32);

    const rows = await this.database.query<AuthSessionRow[]>(
      `SELECT
          s.id,
          s.user_id,
          s.session_family_id,
          s.refresh_expires_at,
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
      [refreshTokenHash32, SESSION_STATUS_ACTIVE],
    );

    return rows[0] ?? null;
  }

  async getActiveSessionFamily(payload: {
    sessionFamilyId: string;
    userId?: number | string | null;
  }): Promise<AuthSessionRow | null> {
    const normalizedFamilyId = assertSessionFamilyId(payload.sessionFamilyId);
    const params: unknown[] = [normalizedFamilyId, SESSION_STATUS_ACTIVE];
    let userSql = "";

    if (
      payload.userId !== null &&
      payload.userId !== undefined &&
      String(payload.userId).trim()
    ) {
      userSql = "AND s.user_id = ?";
      params.push(Number(payload.userId));
    }

    const rows = await this.database.query<AuthSessionRow[]>(
      `SELECT
          s.id,
          s.user_id,
          s.session_family_id,
          s.refresh_expires_at,
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
      params,
    );

    return rows[0] ?? null;
  }

  async rotateRefreshSessionTx(payload: {
    presentedRefreshTokenHash32: Buffer;
    nextRefreshTokenHash32: Buffer;
    requestIpPacked?: Buffer | null;
    userAgentOrNull?: string | null;
  }): Promise<RotateRefreshSessionResult> {
    assertTokenHash32(payload.presentedRefreshTokenHash32);
    assertTokenHash32(payload.nextRefreshTokenHash32);

    return withTxRetry(this.database, async (conn) => {
      const rows = await conn.query<StoredSessionRow[]>(
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
         LIMIT 1
         FOR UPDATE`,
        [payload.presentedRefreshTokenHash32],
      );
      const current = rows[0] ?? null;

      if (!current) return { ok: false, reason: "invalid_or_expired" };

      const user = await selectUserByIdForUpdate(conn, current.user_id);
      if (!user || Number(user.is_active || 0) !== 1) {
        await revokeSessionFamiliesByIdsTx(
          conn,
          [String(current.session_family_id || "")],
          SESSION_STATUS_REVOKED,
        );
        return { ok: false, reason: "invalid_or_expired" };
      }

      const isExpired =
        current.refresh_expires_at !== null &&
        new Date(current.refresh_expires_at).getTime() <= Date.now();
      if (current.status === SESSION_STATUS_ROTATED) {
        await markRotatedTokenReuseTx(conn, current);
        return { ok: false, reason: "reuse_detected" };
      }

      if (current.status !== SESSION_STATUS_ACTIVE || current.revoked_at || isExpired) {
        return { ok: false, reason: "invalid_or_expired" };
      }

      const result = await conn.query<InsertResult>(
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
          payload.nextRefreshTokenHash32,
          current.refresh_expires_at,
          SESSION_STATUS_ACTIVE,
          payload.requestIpPacked || null,
          payload.userAgentOrNull || null,
        ],
      );

      await conn.query(
        `UPDATE ${SESSIONS_TABLE}
         SET status = ?,
             replaced_by_session_id = ?,
             last_used_at = NOW(6)
         WHERE id = ?
         LIMIT 1`,
        [SESSION_STATUS_ROTATED, result.insertId, current.id],
      );

      const freshRows = await conn.query<SessionInsertRow[]>(
        `SELECT id, user_id, session_family_id, refresh_expires_at
         FROM ${SESSIONS_TABLE}
         WHERE id = ?
         LIMIT 1`,
        [result.insertId],
      );
      const fresh = freshRows[0] ?? null;

      return {
        ok: true,
        sessionId: fresh?.id ?? null,
        userId: Number(fresh?.user_id ?? current.user_id),
        sessionFamilyId: String(
          fresh?.session_family_id || current.session_family_id || "",
        ),
        refreshExpiresAt:
          fresh?.refresh_expires_at || current.refresh_expires_at || null,
      };
    });
  }

  async touchSessionFamilyLastUsed(sessionFamilyId: string): Promise<boolean> {
    const normalizedFamilyId = assertSessionFamilyId(sessionFamilyId);
    const result = await this.database.query<InsertResult>(
      `UPDATE ${SESSIONS_TABLE}
       SET last_used_at = NOW(6)
       WHERE session_family_id = ?
         AND status = ?
         AND revoked_at IS NULL`,
      [normalizedFamilyId, SESSION_STATUS_ACTIVE],
    );

    return Boolean((result?.affectedRows ?? 0) >= 1);
  }

  async revokeSessionFamilyById(sessionFamilyId: string): Promise<number> {
    const normalizedFamilyId = assertSessionFamilyId(sessionFamilyId);
    const result = await this.database.query<InsertResult>(
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
      ],
    );

    return Number(result?.affectedRows ?? 0);
  }

  async revokeSessionsByUserId(
    userId: number,
    options: { exceptSessionFamilyId?: string } = {},
  ): Promise<number> {
    const normalizedUserId = assertUserId(userId);
    const exceptSessionFamilyId = options.exceptSessionFamilyId
      ? assertSessionFamilyId(options.exceptSessionFamilyId)
      : null;

    const params: unknown[] = [SESSION_STATUS_REVOKED, normalizedUserId];
    let exceptSql = "";
    if (exceptSessionFamilyId) {
      exceptSql = "AND session_family_id <> ?";
      params.push(exceptSessionFamilyId);
    }

    const result = await this.database.query<InsertResult>(
      `UPDATE ${SESSIONS_TABLE}
       SET status = ?,
           revoked_at = COALESCE(revoked_at, NOW(6))
       WHERE user_id = ?
         ${exceptSql}
         AND status IN (?, ?)`,
      [...params, SESSION_STATUS_ACTIVE, SESSION_STATUS_ROTATED],
    );

    return Number(result?.affectedRows ?? 0);
  }
}
