"use strict";

/**
 * @fileoverview Password reset request/confirm controllers.
 */

const { config } = require("../../config");
const { adminAuthRepository } = require("../../repositories/admin-auth-repository");
const {
  passwordResetRequestsRepository,
  sha256Buffer,
} = require("../../repositories/password-reset-requests-repository");
const {
  hashAdminPassword,
  MIN_PASSWORD_LEN,
  MAX_PASSWORD_LEN,
} = require("../../services/admin-password-service");
const { sendPasswordResetEmail } = require("../../services/password-reset-email-service");
const { normalizeEmailStrict } = require("../../lib/auth-identifiers");
const { clearAuthCookies } = require("../../lib/auth-cookies");
const { isOpaqueTokenFormatValid, normalizeOpaqueToken } = require("../../lib/auth-secrets");
const { logError } = require("../../lib/logger");

function parsePassword(raw) {
  if (typeof raw !== "string") return null;
  if (raw.length < MIN_PASSWORD_LEN || raw.length > MAX_PASSWORD_LEN) return null;
  return raw;
}

function getPasswordResetTtlMinutes() {
  const raw = Number(config.passwordResetTtlMinutes ?? 15);
  if (!Number.isFinite(raw) || raw <= 0 || raw > 60) return 15;
  return Math.floor(raw);
}

function setNoStore(res) {
  res.set("Cache-Control", "no-store");
}

/**
 * POST /auth/forgot-password
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function forgotPassword(req, res) {
  const ttlMinutes = getPasswordResetTtlMinutes();

  try {
    const email = normalizeEmailStrict(req.body?.email);
    if (!email) return res.status(400).json({ error: "invalid_params", field: "email" });

    const user = await adminAuthRepository.getActiveUserByEmail(email);
    if (user) {
      try {
        await sendPasswordResetEmail({
          userId: user.id,
          email: user.email,
          requestIpText: req.ip,
          userAgent: String(req.headers["user-agent"] || ""),
        });
      } catch (err) {
        logError("auth.forgotPassword.send.error", err, req, { email });
      }
    }

    setNoStore(res);
    return res.status(200).json({
      ok: true,
      action: "forgot_password",
      accepted: true,
      recovery: {
        ttl_minutes: ttlMinutes,
      },
    });
  } catch (err) {
    logError("auth.forgotPassword.error", err, req);
    setNoStore(res);
    return res.status(200).json({
      ok: true,
      action: "forgot_password",
      accepted: true,
      recovery: {
        ttl_minutes: ttlMinutes,
      },
    });
  }
}

/**
 * POST /auth/reset-password
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function resetPassword(req, res) {
  try {
    const token = normalizeOpaqueToken(req.body?.token);
    if (!token) return res.status(400).json({ error: "invalid_params", field: "token" });
    if (!isOpaqueTokenFormatValid(token)) return res.status(400).json({ error: "invalid_token" });

    const newPassword = parsePassword(req.body?.new_password);
    if (!newPassword) {
      return res.status(400).json({
        error: "invalid_params",
        field: "new_password",
        hint: `string ${MIN_PASSWORD_LEN}..${MAX_PASSWORD_LEN} chars`,
      });
    }

    const pending = await passwordResetRequestsRepository.getPendingByTokenHash(
      sha256Buffer(token)
    );
    if (!pending) return res.status(400).json({ error: "invalid_or_expired" });

    const passwordHash = await hashAdminPassword(newPassword);
    const result = await passwordResetRequestsRepository.consumePendingAndResetPasswordTx({
      tokenHash32: sha256Buffer(token),
      passwordHash,
    });

    if (!result.ok) return res.status(400).json({ error: "invalid_or_expired" });

    clearAuthCookies(res, config.appEnv || config.envName, config.authCookieSameSite);
    setNoStore(res);
    return res.status(200).json({
      ok: true,
      action: "reset_password",
      updated: true,
      reauth_required: true,
      sessions_revoked: Number(result.sessionsRevoked ?? 0),
      user: result.user || null,
    });
  } catch (err) {
    if (err && err.code === "tx_busy") {
      return res.status(503).json({ error: "temporarily_unavailable" });
    }
    logError("auth.resetPassword.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

module.exports = {
  forgotPassword,
  resetPassword,
};
