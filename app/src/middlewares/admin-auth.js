"use strict";

/**
 * @fileoverview Admin cookie authentication middleware.
 */

const { logError } = require("../lib/logger");
const { adminAuthRepository } = require("../repositories/admin-auth-repository");
const { resolveAccessSession } = require("../lib/auth-session-context");

/**
 * Require a valid admin access JWT cookie.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function requireAdminAuth(req, res, next) {
  try {
    const auth = await resolveAccessSession(req);
    if (!auth) return res.status(401).json({ error: "invalid_or_expired_session" });
    if (Number(auth.is_admin || 0) !== 1) return res.status(403).json({ error: "admin_required" });

    req.auth = auth;
    req.admin_auth = auth;
    adminAuthRepository.touchSessionFamilyLastUsed(auth.session_family_id).catch(() => {});
    return next();
  } catch (err) {
    logError("admin.auth.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

module.exports = { requireAdminAuth };
