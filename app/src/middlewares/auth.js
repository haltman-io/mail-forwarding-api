"use strict";

/**
 * @fileoverview Shared bearer-token authentication middleware.
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

function parseAuthToken(req, options = {}) {
  const allowAdminHeader = options.allowAdminHeader === true;
  const authorization = String(req.header("Authorization") || "").trim();
  if (authorization) {
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (match) return String(match[1] || "").trim().toLowerCase();
  }

  const fallbackHeaders = allowAdminHeader ? ["X-Auth-Token", "X-Admin-Token"] : ["X-Auth-Token"];
  for (const headerName of fallbackHeaders) {
    const token = String(req.header(headerName) || "").trim().toLowerCase();
    if (token) return token;
  }

  return "";
}

async function getAuthSessionByToken(token) {
  const tokenHash32 = sha256Buffer(token);
  return adminAuthRepository.getActiveSessionByTokenHash(tokenHash32);
}

/**
 * Require a valid bearer token for any user.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function requireAuth(req, res, next) {
  try {
    const token = parseAuthToken(req);
    if (!token) return res.status(401).json({ error: "missing_auth_token" });

    const expectedLen = expectedTokenHexLength();
    if (token.length !== expectedLen || !/^[a-f0-9]+$/.test(token)) {
      return res.status(401).json({ error: "invalid_auth_token_format" });
    }

    const session = await getAuthSessionByToken(token);
    if (!session) return res.status(401).json({ error: "invalid_or_expired_auth_token" });

    req.auth = {
      session_id: session.session_id,
      user_id: session.user_id,
      email: session.email,
      is_admin: Number(session.is_admin || 0),
      expires_at: session.expires_at,
    };

    adminAuthRepository.touchSessionLastUsed(session.session_id).catch(() => {});
    return next();
  } catch (err) {
    logError("auth.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

module.exports = {
  parseAuthToken,
  expectedTokenHexLength,
  getAuthSessionByToken,
  requireAuth,
};
