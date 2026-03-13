"use strict";

/**
 * @fileoverview Unified authentication controller for users and admins.
 */

const crypto = require("crypto");
const { config } = require("../../config");
const { adminAuthRepository } = require("../../repositories/admin-auth-repository");
const {
  hashAdminPassword,
  verifyAdminPassword,
  MIN_PASSWORD_LEN,
  MAX_PASSWORD_LEN,
} = require("../../services/admin-password-service");
const { sendAdminLoginNotificationEmail } = require("../../services/admin-login-email-service");
const { parseMailbox } = require("../../lib/mailbox-validation");
const { packIp16 } = require("../../lib/ip-pack");
const { logError } = require("../../lib/logger");

const FALLBACK_DUMMY_ADMIN_PASSWORD_HASH =
  "$argon2id$v=19$m=131072,t=4,p=1$L/mffIBj9C0gzyzOnmkUHQ$FgGLHMi1bdENEMchXbgdisn0+oOmolSiP//2841TDBM";

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest();
}

function normalizeEmailStrict(raw) {
  const parsed = parseMailbox(raw);
  if (!parsed) return null;
  if (parsed.email.length > 254) return null;
  return parsed.email;
}

function parsePassword(raw) {
  if (typeof raw !== "string") return null;
  if (raw.length < MIN_PASSWORD_LEN || raw.length > MAX_PASSWORD_LEN) return null;
  return raw;
}

function getTokenBytes() {
  const raw = Number(config.adminAuthTokenBytes ?? 32);
  if (!Number.isFinite(raw) || raw < 16 || raw > 64) return 32;
  return Math.floor(raw);
}

function getSessionTtlMinutes() {
  const raw = Number(config.adminAuthSessionTtlMinutes ?? 12 * 60);
  if (!Number.isFinite(raw) || raw < 5 || raw > 7 * 24 * 60) return 12 * 60;
  return Math.floor(raw);
}

function getDummyHash() {
  const configured = String(config.adminAuthDummyPasswordHash || "").trim();
  return configured || FALLBACK_DUMMY_ADMIN_PASSWORD_HASH;
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
    // Intentionally ignore: this call only equalizes cost for invalid attempts.
  }
}

function toPublicAuthUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    is_active: Number(row.is_active || 0),
    is_admin: Number(row.is_admin || 0) === 1,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    last_login_at: row.last_login_at || null,
  };
}

/**
 * POST /auth/register
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function registerUser(req, res) {
  try {
    const email = normalizeEmailStrict(req.body?.email);
    if (!email) return res.status(400).json({ error: "invalid_params", field: "email" });

    const password = parsePassword(req.body?.password);
    if (!password) {
      return res.status(400).json({
        error: "invalid_params",
        field: "password",
        hint: `string ${MIN_PASSWORD_LEN}..${MAX_PASSWORD_LEN} chars`,
      });
    }

    const existing = await adminAuthRepository.getUserByEmail(email);
    if (existing) return res.status(409).json({ error: "user_taken", email });

    const passwordHash = await hashAdminPassword(password);
    const created = await adminAuthRepository.createUser({
      email,
      passwordHash,
      isActive: 1,
      isAdmin: 0,
    });
    const user = await adminAuthRepository.getUserById(created.insertId);

    return res.status(201).json({
      ok: true,
      created: true,
      user: toPublicAuthUser(user),
    });
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "user_taken" });
    }
    logError("auth.register.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * POST /auth/login
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function login(req, res) {
  try {
    const emailRaw = req.body?.email;
    const passwordRaw = req.body?.password;

    const email = normalizeEmailStrict(emailRaw);
    if (!email) {
      await consumeSlowVerify(passwordRaw);
      return res.status(400).json({ error: "invalid_params", field: "email" });
    }

    const password = parsePassword(passwordRaw);
    if (!password) {
      await consumeSlowVerify(passwordRaw);
      return res.status(400).json({
        error: "invalid_params",
        field: "password",
        hint: `string ${MIN_PASSWORD_LEN}..${MAX_PASSWORD_LEN} chars`,
      });
    }

    const user = await adminAuthRepository.getActiveUserByEmail(email);
    const passwordHash = String(user?.password_hash || getDummyHash());
    let isPasswordValid = false;

    try {
      isPasswordValid = await verifyAdminPassword(passwordHash, password);
    } catch (_) {
      isPasswordValid = false;
    }

    if (!user || !isPasswordValid) {
      return res.status(401).json({ error: "invalid_credentials" });
    }

    const token = crypto.randomBytes(getTokenBytes()).toString("hex");
    const tokenHash32 = sha256Buffer(token);
    const userAgent = String(req.headers["user-agent"] || "").slice(0, 255);
    const requestIpPacked = req.ip ? packIp16(req.ip) : null;
    const ttlMinutes = getSessionTtlMinutes();

    const session = await adminAuthRepository.createSession({
      userId: user.id,
      tokenHash32,
      ttlMinutes,
      requestIpPacked,
      userAgentOrNull: userAgent || null,
    });

    if (!session.ok) throw new Error("auth_session_create_failed");

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
        logError("auth.login.notify.error", notifyErr, req, { admin_email: user.email });
      }
    }

    const freshUser = await adminAuthRepository.getUserById(user.id);

    res.set("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      action: "login",
      user: toPublicAuthUser(freshUser || user),
      auth: {
        token,
        token_type: "bearer",
        expires_at: session.expiresAt,
      },
    });
  } catch (err) {
    logError("auth.login.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * GET /auth/me
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function getMe(req, res) {
  try {
    const userId = Number(req.auth?.user_id || 0);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: "invalid_or_expired_auth_token" });
    }

    const user = await adminAuthRepository.getUserById(userId);
    if (!user || Number(user.is_active || 0) !== 1) {
      return res.status(401).json({ error: "invalid_or_expired_auth_token" });
    }

    return res.status(200).json({
      ok: true,
      authenticated: true,
      user: toPublicAuthUser(user),
      auth: {
        session_id: req.auth?.session_id || null,
        token_type: "bearer",
        expires_at: req.auth?.expires_at || null,
      },
    });
  } catch (err) {
    logError("auth.me.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

module.exports = {
  registerUser,
  login,
  getMe,
};
