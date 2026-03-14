"use strict";

/**
 * @fileoverview Access-JWT cookie authentication middleware.
 */

const { logError } = require("../lib/logger");
const { adminAuthRepository } = require("../repositories/admin-auth-repository");
const { resolveAccessSession } = require("../lib/auth-session-context");

/**
 * Require a valid access JWT cookie backed by a live session family.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function requireAuth(req, res, next) {
  try {
    const auth = await resolveAccessSession(req);
    if (!auth) return res.status(401).json({ error: "invalid_or_expired_session" });

    req.auth = auth;
    adminAuthRepository.touchSessionFamilyLastUsed(auth.session_family_id).catch(() => {});
    return next();
  } catch (err) {
    logError("auth.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

module.exports = {
  requireAuth,
};
