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
const { parseMailbox } = require("../../lib/mailbox-validation");
const { logError } = require("../../lib/logger");
const {
  normalizeConfirmationCode,
  isConfirmationCodeValid,
} = require("../../lib/confirmation-code");

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

function getPasswordResetTtlMinutes() {
  const raw = Number(config.passwordResetTtlMinutes ?? 15);
  if (!Number.isFinite(raw) || raw <= 0 || raw > 60) return 15;
  return Math.floor(raw);
}

/**
 * POST /auth/password/forgot
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function requestPasswordReset(req, res) {
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
        logError("auth.passwordReset.request.send.error", err, req, { email });
      }
    }

    return res.status(200).json({
      ok: true,
      action: "password_reset_request",
      accepted: true,
      recovery: {
        ttl_minutes: ttlMinutes,
      },
    });
  } catch (err) {
    logError("auth.passwordReset.request.error", err, req);
    return res.status(200).json({
      ok: true,
      action: "password_reset_request",
      accepted: true,
      recovery: {
        ttl_minutes: ttlMinutes,
      },
    });
  }
}

/**
 * POST /auth/password/reset
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function resetPassword(req, res) {
  try {
    const token = normalizeConfirmationCode(req.body?.token || req.query?.token || "");
    if (!token) return res.status(400).json({ error: "invalid_params", field: "token" });
    if (!isConfirmationCodeValid(token)) return res.status(400).json({ error: "invalid_token" });

    const newPassword = parsePassword(req.body?.new_password);
    if (!newPassword) {
      return res.status(400).json({
        error: "invalid_params",
        field: "new_password",
        hint: `string ${MIN_PASSWORD_LEN}..${MAX_PASSWORD_LEN} chars`,
      });
    }

    const tokenHash32 = sha256Buffer(token);
    const pending = await passwordResetRequestsRepository.getPendingByTokenHash(tokenHash32);
    if (!pending) return res.status(400).json({ error: "invalid_or_expired" });

    const passwordHash = await hashAdminPassword(newPassword);
    const result = await passwordResetRequestsRepository.consumePendingAndResetPasswordTx({
      tokenHash32,
      passwordHash,
    });

    if (!result.ok) return res.status(400).json({ error: "invalid_or_expired" });

    res.set("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      action: "password_reset",
      updated: true,
      reauth_required: true,
      sessions_revoked: Number(result.sessionsRevoked ?? 0),
      user: result.user || null,
    });
  } catch (err) {
    if (err && err.code === "tx_busy") {
      return res.status(503).json({ error: "temporarily_unavailable" });
    }
    logError("auth.passwordReset.reset.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

module.exports = {
  requestPasswordReset,
  resetPassword,
};
