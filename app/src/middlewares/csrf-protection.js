"use strict";

/**
 * @fileoverview CSRF protection for authenticated state-changing routes.
 */

const { isCsrfTokenValid, readCsrfHeader } = require("../lib/csrf");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
function requireCsrfForAuthenticatedMutation(req, res, next) {
  if (SAFE_METHODS.has(String(req.method || "GET").toUpperCase())) {
    return next();
  }

  const sessionFamilyId =
    String(req.admin_auth?.session_family_id || req.auth?.session_family_id || "").trim();
  if (!sessionFamilyId) {
    return res.status(401).json({ error: "invalid_or_expired_session" });
  }

  const providedToken = readCsrfHeader(req);
  if (!providedToken) return res.status(403).json({ error: "csrf_required" });
  if (!isCsrfTokenValid(sessionFamilyId, providedToken)) {
    return res.status(403).json({ error: "invalid_csrf_token" });
  }

  return next();
}

module.exports = {
  requireCsrfForAuthenticatedMutation,
};
