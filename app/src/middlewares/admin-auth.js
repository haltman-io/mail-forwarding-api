"use strict";

/**
 * @fileoverview Admin bearer-token authentication middleware.
 */

const crypto = require("crypto");
const { config } = require("../config");
const { adminAuthRepository } = require("../repositories/admin-auth-repository");
const { logError } = require("../lib/logger");

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest();
}

function expectedTokenHexLength() {
  const bytes = Number(config.adminAuthTokenBytes ?? 32);
  if (!Number.isFinite(bytes) || bytes < 16 || bytes > 64) return 64;
  return Math.floor(bytes) * 2;
}

function parseAdminToken(req) {
  const authorization = String(req.header("Authorization") || "").trim();
  if (authorization) {
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (match) return String(match[1] || "").trim().toLowerCase();
  }
  return String(req.header("X-Admin-Token") || "").trim().toLowerCase();
}

/**
 * Require a valid admin bearer token.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function requireAdminAuth(req, res, next) {
  try {
    const token = parseAdminToken(req);
    if (!token) return res.status(401).json({ error: "missing_admin_token" });

    const expectedLen = expectedTokenHexLength();
    if (token.length !== expectedLen || !/^[a-f0-9]+$/.test(token)) {
      return res.status(401).json({ error: "invalid_admin_token_format" });
    }

    const tokenHash32 = sha256Buffer(token);
    const session = await adminAuthRepository.getActiveSessionByTokenHash(tokenHash32);
    if (!session) return res.status(401).json({ error: "invalid_or_expired_admin_token" });

    req.admin_auth = {
      session_id: session.session_id,
      user_id: session.user_id,
      email: session.email,
      expires_at: session.expires_at,
    };

    adminAuthRepository.touchSessionLastUsed(session.session_id).catch(() => {});
    return next();
  } catch (err) {
    logError("admin.auth.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

module.exports = { requireAdminAuth };
