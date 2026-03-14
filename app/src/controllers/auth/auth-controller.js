"use strict";

/**
 * @fileoverview Browser auth controller with JWT access cookies and refresh sessions.
 */

const { config } = require("../../config");
const { adminAuthRepository } = require("../../repositories/admin-auth-repository");
const {
  emailVerificationTokensRepository,
} = require("../../repositories/email-verification-tokens-repository");
const {
  hashAdminPassword,
  verifyAdminPassword,
  MIN_PASSWORD_LEN,
  MAX_PASSWORD_LEN,
} = require("../../services/admin-password-service");
const {
  sendEmailVerificationEmail,
} = require("../../services/email-verification-email-service");
const { sendAdminLoginNotificationEmail } = require("../../services/admin-login-email-service");
const { packIp16 } = require("../../lib/ip-pack");
const { logError } = require("../../lib/logger");
const {
  normalizeEmailStrict,
  normalizeUsername,
  parseIdentifier,
} = require("../../lib/auth-identifiers");
const {
  buildCookieOptions,
  clearAuthCookies,
  setAccessCookie,
  setRefreshCookie,
} = require("../../lib/auth-cookies");
const { mintAccessJwt } = require("../../lib/access-jwt");
const { deriveCsrfToken, readCsrfHeader, isCsrfTokenValid } = require("../../lib/csrf");
const {
  createOpaqueToken,
  isOpaqueTokenFormatValid,
  normalizeOpaqueToken,
  sha256Buffer,
} = require("../../lib/auth-secrets");
const {
  getRefreshCookie,
  resolveAccessOrRefreshSession,
  resolveRefreshSession,
} = require("../../lib/auth-session-context");

const FALLBACK_DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=131072,t=4,p=1$L/mffIBj9C0gzyzOnmkUHQ$FgGLHMi1bdENEMchXbgdisn0+oOmolSiP//2841TDBM";

function parsePassword(raw) {
  if (typeof raw !== "string") return null;
  if (raw.length < MIN_PASSWORD_LEN || raw.length > MAX_PASSWORD_LEN) return null;
  return raw;
}

function getRefreshTtlDays() {
  const raw = Number(config.authRefreshTtlDays ?? 30);
  if (!Number.isFinite(raw) || raw <= 0 || raw > 365) return 30;
  return Math.floor(raw);
}

function getMaxActiveSessionFamilies() {
  const raw = Number(config.authMaxActiveSessionFamilies ?? 5);
  if (!Number.isFinite(raw) || raw <= 0 || raw > 100) return 5;
  return Math.floor(raw);
}

function getDummyHash() {
  const configured = String(config.adminAuthDummyPasswordHash || "").trim();
  return configured || FALLBACK_DUMMY_PASSWORD_HASH;
}

function normalizePasswordForSlowVerify(raw) {
  if (typeof raw === "string" && raw.length >= MIN_PASSWORD_LEN && raw.length <= MAX_PASSWORD_LEN) {
    return raw;
  }
  return "invalid-password-placeholder";
}

async function consumeSlowVerify(rawPassword) {
  const password = normalizePasswordForSlowVerify(rawPassword);
  try {
    await verifyAdminPassword(getDummyHash(), password);
  } catch (_) {
    // Intentionally ignored to normalize login failure cost.
  }
}

function toPublicAuthUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    email_verified_at: row.email_verified_at || null,
    is_active: Number(row.is_active || 0),
    is_admin: Number(row.is_admin || 0) === 1,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    last_login_at: row.last_login_at || null,
  };
}

function setNoStore(res) {
  res.set("Cache-Control", "no-store");
}

function setAuthCookies(res, { accessToken, refreshToken, refreshExpiresAt }) {
  const envName = config.envName || config.appEnv;
  const sameSite = config.authCookieSameSite;
  const accessCookieOptions = buildCookieOptions({
    maxAgeMs: Number(config.jwtAccessTtlSeconds ?? 600) * 1000,
    envName,
    sameSite,
  });
  const refreshMaxAgeMs = Math.max(
    0,
    new Date(refreshExpiresAt).getTime() - Date.now()
  );
  const refreshCookieOptions = buildCookieOptions({
    maxAgeMs: refreshMaxAgeMs,
    envName,
    sameSite,
  });

  setAccessCookie(res, accessToken, accessCookieOptions);
  setRefreshCookie(res, refreshToken, refreshCookieOptions);
}

function clearCookies(res) {
  clearAuthCookies(res, config.envName || config.appEnv, config.authCookieSameSite);
}

function genericSignUpResponse(res) {
  setNoStore(res);
  return res.status(202).json({
    ok: true,
    action: "sign_up",
    accepted: true,
  });
}

function genericForgotPasswordResponse(res) {
  setNoStore(res);
  return res.status(200).json({
    ok: true,
    action: "forgot_password",
    accepted: true,
  });
}

async function trySendVerificationEmail({ userId, email, req }) {
  try {
    await sendEmailVerificationEmail({
      userId,
      email,
      requestIpText: req.ip,
      userAgent: String(req.headers["user-agent"] || ""),
    });
  } catch (err) {
    logError("auth.signUp.sendVerification.error", err, req, { user_id: userId, email });
  }
}

/**
 * POST /auth/sign-up
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function signUp(req, res) {
  try {
    const email = normalizeEmailStrict(req.body?.email);
    if (!email) return res.status(400).json({ error: "invalid_params", field: "email" });

    const username = normalizeUsername(req.body?.username);
    if (!username) return res.status(400).json({ error: "invalid_params", field: "username" });

    const password = parsePassword(req.body?.password);
    if (!password) {
      return res.status(400).json({
        error: "invalid_params",
        field: "password",
        hint: `string ${MIN_PASSWORD_LEN}..${MAX_PASSWORD_LEN} chars`,
      });
    }

    const [existingByEmail, existingByUsername] = await Promise.all([
      adminAuthRepository.getUserByEmail(email).catch(() => null),
      adminAuthRepository.getUserByUsername(username).catch(() => null),
    ]);

    if (existingByEmail) {
      if (!existingByEmail.email_verified_at) {
        await trySendVerificationEmail({ userId: existingByEmail.id, email: existingByEmail.email, req });
      }
      return genericSignUpResponse(res);
    }

    if (existingByUsername) {
      return genericSignUpResponse(res);
    }

    const passwordHash = await hashAdminPassword(password);
    const created = await adminAuthRepository.createUser({
      email,
      username,
      passwordHash,
      isActive: 1,
      isAdmin: 0,
      emailVerifiedAt: null,
    });

    if (created.insertId) {
      await trySendVerificationEmail({ userId: created.insertId, email, req });
    }

    return genericSignUpResponse(res);
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      return genericSignUpResponse(res);
    }
    logError("auth.signUp.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * POST /auth/verify-email
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function verifyEmail(req, res) {
  try {
    const token = normalizeOpaqueToken(req.body?.token);
    if (!token) return res.status(400).json({ error: "invalid_params", field: "token" });
    if (!isOpaqueTokenFormatValid(token)) return res.status(400).json({ error: "invalid_token" });

    const result = await emailVerificationTokensRepository.consumePendingTokenTx({
      tokenHash32: sha256Buffer(token),
    });
    if (!result.ok) return res.status(400).json({ error: "invalid_or_expired" });

    setNoStore(res);
    return res.status(200).json({
      ok: true,
      action: "verify_email",
      verified: true,
      user: result.user || null,
    });
  } catch (err) {
    if (err && err.code === "tx_busy") {
      return res.status(503).json({ error: "temporarily_unavailable" });
    }
    logError("auth.verifyEmail.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * POST /auth/sign-in
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function signIn(req, res) {
  try {
    const identifier = parseIdentifier(req.body?.identifier);
    if (!identifier) {
      await consumeSlowVerify(req.body?.password);
      return res.status(400).json({ error: "invalid_params", field: "identifier" });
    }

    const password = parsePassword(req.body?.password);
    if (!password) {
      await consumeSlowVerify(req.body?.password);
      return res.status(400).json({
        error: "invalid_params",
        field: "password",
        hint: `string ${MIN_PASSWORD_LEN}..${MAX_PASSWORD_LEN} chars`,
      });
    }

    const user = await adminAuthRepository.getActiveUserByIdentifier(identifier);
    const passwordHash = String(user?.password_hash || getDummyHash());
    let isPasswordValid = false;

    try {
      isPasswordValid = await verifyAdminPassword(passwordHash, password);
    } catch (_) {
      isPasswordValid = false;
    }

    if (!user || !isPasswordValid || !user.email_verified_at) {
      return res.status(401).json({ error: "auth_failed" });
    }

    const refreshToken = createOpaqueToken();
    const requestIpPacked = req.ip ? packIp16(req.ip) : null;
    const userAgent = String(req.headers["user-agent"] || "").slice(0, 255);
    const session = await adminAuthRepository.createSessionFamilyTx({
      userId: user.id,
      refreshTokenHash32: sha256Buffer(refreshToken),
      refreshTtlDays: getRefreshTtlDays(),
      requestIpPacked,
      userAgentOrNull: userAgent || null,
      maxActiveFamilies: getMaxActiveSessionFamilies(),
    });

    if (!session.ok || !session.sessionFamilyId) throw new Error("auth_session_create_failed");

    const access = mintAccessJwt({
      userId: user.id,
      sessionFamilyId: session.sessionFamilyId,
    });

    setAuthCookies(res, {
      accessToken: access.token,
      refreshToken,
      refreshExpiresAt: session.refreshExpiresAt,
    });

    await adminAuthRepository.updateLastLoginAtById(user.id);

    if (Number(user.is_admin || 0) === 1 && config.adminLoginEmailEnabled) {
      try {
        await sendAdminLoginNotificationEmail({
          email: user.email,
          requestIpText: req.ip || "",
          userAgent,
          occurredAt: new Date(),
        });
      } catch (notifyErr) {
        logError("auth.signIn.notify.error", notifyErr, req, { admin_email: user.email });
      }
    }

    const freshUser = await adminAuthRepository.getUserById(user.id);

    setNoStore(res);
    return res.status(200).json({
      ok: true,
      action: "sign_in",
      authenticated: true,
      user: toPublicAuthUser(freshUser || user),
      session: {
        session_family_id: session.sessionFamilyId,
        access_expires_at: new Date(Number(access.claims.exp) * 1000).toISOString(),
        refresh_expires_at: session.refreshExpiresAt || null,
      },
    });
  } catch (err) {
    logError("auth.signIn.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * GET /auth/session
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function getSession(req, res) {
  try {
    const userId = Number(req.auth?.user_id || 0);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: "invalid_or_expired_session" });
    }

    const user = await adminAuthRepository.getUserById(userId);
    if (!user || Number(user.is_active || 0) !== 1) {
      return res.status(401).json({ error: "invalid_or_expired_session" });
    }

    setNoStore(res);
    return res.status(200).json({
      ok: true,
      authenticated: true,
      user: toPublicAuthUser(user),
      session: {
        session_family_id: req.auth?.session_family_id || null,
        access_expires_at: req.auth?.access_expires_at || null,
        refresh_expires_at: req.auth?.refresh_expires_at || null,
      },
    });
  } catch (err) {
    logError("auth.session.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * GET /auth/csrf
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function getCsrf(req, res) {
  try {
    const auth = await resolveAccessOrRefreshSession(req);
    if (!auth) return res.status(401).json({ error: "invalid_or_expired_session" });

    setNoStore(res);
    return res.status(200).json({
      ok: true,
      csrf_token: deriveCsrfToken(auth.session_family_id),
    });
  } catch (err) {
    logError("auth.csrf.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * POST /auth/refresh
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function refreshSession(req, res) {
  try {
    const refreshContext = await resolveRefreshSession(req);
    const refreshToken = normalizeOpaqueToken(getRefreshCookie(req));

    if (!refreshContext || !refreshToken) {
      clearCookies(res);
      return res.status(401).json({ error: "invalid_or_expired_session" });
    }

    const csrfToken = readCsrfHeader(req);
    if (!csrfToken) return res.status(403).json({ error: "csrf_required" });
    if (!isCsrfTokenValid(refreshContext.session_family_id, csrfToken)) {
      return res.status(403).json({ error: "invalid_csrf_token" });
    }

    const nextRefreshToken = createOpaqueToken();
    const requestIpPacked = req.ip ? packIp16(req.ip) : null;
    const userAgent = String(req.headers["user-agent"] || "").slice(0, 255);
    const rotated = await adminAuthRepository.rotateRefreshSessionTx({
      presentedRefreshTokenHash32: sha256Buffer(refreshToken),
      nextRefreshTokenHash32: sha256Buffer(nextRefreshToken),
      requestIpPacked,
      userAgentOrNull: userAgent || null,
    });

    if (!rotated.ok) {
      clearCookies(res);
      return res.status(401).json({ error: "invalid_or_expired_session" });
    }

    const access = mintAccessJwt({
      userId: rotated.userId,
      sessionFamilyId: rotated.sessionFamilyId,
    });

    setAuthCookies(res, {
      accessToken: access.token,
      refreshToken: nextRefreshToken,
      refreshExpiresAt: rotated.refreshExpiresAt,
    });

    setNoStore(res);
    return res.status(200).json({
      ok: true,
      action: "refresh",
      refreshed: true,
      session: {
        session_family_id: rotated.sessionFamilyId,
        access_expires_at: new Date(Number(access.claims.exp) * 1000).toISOString(),
        refresh_expires_at: rotated.refreshExpiresAt || null,
      },
    });
  } catch (err) {
    if (err && err.code === "tx_busy") {
      return res.status(503).json({ error: "temporarily_unavailable" });
    }
    logError("auth.refresh.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * POST /auth/sign-out
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function signOut(req, res) {
  try {
    const auth = await resolveAccessOrRefreshSession(req);
    if (auth) {
      const csrfToken = readCsrfHeader(req);
      if (!csrfToken) return res.status(403).json({ error: "csrf_required" });
      if (!isCsrfTokenValid(auth.session_family_id, csrfToken)) {
        return res.status(403).json({ error: "invalid_csrf_token" });
      }

      await adminAuthRepository.revokeSessionFamilyById(auth.session_family_id);
    }

    clearCookies(res);
    setNoStore(res);
    return res.status(200).json({
      ok: true,
      action: "sign_out",
      signed_out: true,
    });
  } catch (err) {
    logError("auth.signOut.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * POST /auth/sign-out-all
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function signOutAll(req, res) {
  try {
    const auth = await resolveAccessOrRefreshSession(req);
    let revoked = 0;

    if (auth) {
      const csrfToken = readCsrfHeader(req);
      if (!csrfToken) return res.status(403).json({ error: "csrf_required" });
      if (!isCsrfTokenValid(auth.session_family_id, csrfToken)) {
        return res.status(403).json({ error: "invalid_csrf_token" });
      }

      revoked = await adminAuthRepository.revokeSessionsByUserId(auth.user_id);
    }

    clearCookies(res);
    setNoStore(res);
    return res.status(200).json({
      ok: true,
      action: "sign_out_all",
      signed_out_all: true,
      sessions_revoked: revoked,
    });
  } catch (err) {
    logError("auth.signOutAll.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

module.exports = {
  signUp,
  verifyEmail,
  signIn,
  getSession,
  getCsrf,
  refreshSession,
  signOut,
  signOutAll,
};
