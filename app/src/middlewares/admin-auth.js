"use strict";

/**
 * @fileoverview Admin bearer-token authentication middleware.
 */

const { adminAuthRepository } = require("../repositories/admin-auth-repository");
const {
  parseAuthToken,
  expectedTokenHexLength,
  getAuthSessionByToken,
} = require("./auth");
const { logError } = require("../lib/logger");

/**
 * Require a valid admin bearer token.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function requireAdminAuth(req, res, next) {
  try {
    const token = parseAuthToken(req, { allowAdminHeader: true });
    if (!token) return res.status(401).json({ error: "missing_admin_token" });

    const expectedLen = expectedTokenHexLength();
    if (token.length !== expectedLen || !/^[a-f0-9]+$/.test(token)) {
      return res.status(401).json({ error: "invalid_admin_token_format" });
    }

    const session = await getAuthSessionByToken(token);
    if (!session) return res.status(401).json({ error: "invalid_or_expired_admin_token" });
    if (Number(session.is_admin || 0) !== 1) return res.status(403).json({ error: "admin_required" });

    req.auth = {
      session_id: session.session_id,
      user_id: session.user_id,
      email: session.email,
      is_admin: Number(session.is_admin || 0),
      expires_at: session.expires_at,
    };
    req.admin_auth = req.auth;

    adminAuthRepository.touchSessionLastUsed(session.session_id).catch(() => {});
    return next();
  } catch (err) {
    logError("admin.auth.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

module.exports = { requireAdminAuth };
