"use strict";

/**
 * @fileoverview Admin login controller.
 */

const crypto = require("crypto");
const { config } = require("../../config");
const { adminAuthRepository } = require("../../repositories/admin-auth-repository");
const {
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

/**
 * POST /admin/login
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function adminLogin(req, res) {
  try {
    const emailRaw = req.body?.email;
    const passwordRaw = req.body?.password;

    const email = normalizeEmailStrict(emailRaw);
    if (!email) return res.status(400).json({ error: "invalid_params", field: "email" });

    const password = parsePassword(passwordRaw);
    if (!password) {
      return res.status(400).json({
        error: "invalid_params",
        field: "password",
        hint: `string ${MIN_PASSWORD_LEN}..${MAX_PASSWORD_LEN} chars`,
      });
    }

    const adminUser = await adminAuthRepository.getActiveUserByEmail(email);

    const passwordHash = String(adminUser?.password_hash || getDummyHash());
    let isPasswordValid = false;

    try {
      // Required flow: compare only through argon2.verify(storedHash, plainPassword).
      isPasswordValid = await verifyAdminPassword(passwordHash, password);
    } catch (_) {
      isPasswordValid = false;
    }

    if (!adminUser || !isPasswordValid) {
      return res.status(401).json({ error: "invalid_credentials" });
    }

    const token = crypto.randomBytes(getTokenBytes()).toString("hex");
    const tokenHash32 = sha256Buffer(token);
    const userAgent = String(req.headers["user-agent"] || "").slice(0, 255);
    const requestIpPacked = req.ip ? packIp16(req.ip) : null;
    const ttlMinutes = getSessionTtlMinutes();

    const session = await adminAuthRepository.createSession({
      adminUserId: adminUser.id,
      tokenHash32,
      ttlMinutes,
      requestIpPacked,
      userAgentOrNull: userAgent || null,
    });

    if (!session.ok) throw new Error("admin_session_create_failed");

    await adminAuthRepository.updateLastLoginAtById(adminUser.id);

    if (config.adminLoginEmailEnabled) {
      try {
        await sendAdminLoginNotificationEmail({
          email: adminUser.email,
          requestIpText: req.ip || "",
          userAgent,
          occurredAt: new Date(),
        });
      } catch (notifyErr) {
        logError("admin.login.notify.error", notifyErr, req, { admin_email: adminUser.email });
      }
    }

    res.set("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      action: "admin_login",
      admin: {
        email: adminUser.email,
      },
      auth: {
        token,
        token_type: "bearer",
        expires_at: session.expiresAt,
      },
    });
  } catch (err) {
    logError("admin.login.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * GET /admin/me
 * Helper route to verify admin authentication and fetch common profile info.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function getAdminMe(req, res) {
  try {
    const userId = Number(req.admin_auth?.user_id || 0);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: "invalid_or_expired_admin_token" });
    }

    const user = await adminAuthRepository.getUserById(userId);
    if (!user || Number(user.is_active || 0) !== 1) {
      return res.status(401).json({ error: "invalid_or_expired_admin_token" });
    }

    return res.status(200).json({
      ok: true,
      authenticated: true,
      admin: {
        id: user.id,
        email: user.email,
        is_active: Number(user.is_active || 0),
        created_at: user.created_at || null,
        updated_at: user.updated_at || null,
        last_login_at: user.last_login_at || null,
      },
      auth: {
        session_id: req.admin_auth?.session_id || null,
        token_type: "bearer",
        expires_at: req.admin_auth?.expires_at || null,
      },
    });
  } catch (err) {
    logError("admin.me.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

module.exports = { adminLogin, getAdminMe };
