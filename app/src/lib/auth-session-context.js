"use strict";

/**
 * @fileoverview Resolve auth context from access and refresh cookies.
 */

const { adminAuthRepository } = require("../repositories/admin-auth-repository");
const { verifyAccessJwt } = require("./access-jwt");
const {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  readCookie,
} = require("./auth-cookies");
const {
  normalizeOpaqueToken,
  sha256Buffer,
} = require("./auth-secrets");

function toResolvedContext(sessionRow, accessClaims = null) {
  if (!sessionRow) return null;
  return {
    session_id: sessionRow.id,
    session_family_id: sessionRow.session_family_id,
    user_id: sessionRow.user_id,
    username: sessionRow.username,
    email: sessionRow.email,
    is_admin: Number(sessionRow.is_admin || 0),
    email_verified_at: sessionRow.email_verified_at || null,
    refresh_expires_at: sessionRow.refresh_expires_at || null,
    password_changed_at: sessionRow.password_changed_at || null,
    access_claims: accessClaims,
    access_expires_at: accessClaims?.exp
      ? new Date(Number(accessClaims.exp) * 1000).toISOString()
      : null,
  };
}

/**
 * @param {import("express").Request} req
 * @returns {string}
 */
function getAccessCookie(req) {
  return readCookie(req, ACCESS_COOKIE_NAME);
}

/**
 * @param {import("express").Request} req
 * @returns {string}
 */
function getRefreshCookie(req) {
  return readCookie(req, REFRESH_COOKIE_NAME);
}

/**
 * @param {import("express").Request} req
 * @returns {Promise<object | null>}
 */
async function resolveAccessSession(req) {
  const token = getAccessCookie(req);
  if (!token) return null;

  try {
    const { claims } = verifyAccessJwt(token);
    const sessionRow = await adminAuthRepository.getActiveSessionFamily({
      sessionFamilyId: String(claims.sid || ""),
      userId: claims.sub,
    });
    if (!sessionRow) return null;
    return toResolvedContext(sessionRow, claims);
  } catch (_) {
    return null;
  }
}

/**
 * @param {import("express").Request} req
 * @returns {Promise<object | null>}
 */
async function resolveRefreshSession(req) {
  const refreshToken = normalizeOpaqueToken(getRefreshCookie(req));
  if (!refreshToken) return null;

  try {
    const sessionRow = await adminAuthRepository.getActiveSessionByRefreshTokenHash(
      sha256Buffer(refreshToken)
    );
    if (!sessionRow) return null;
    return toResolvedContext(sessionRow, null);
  } catch (_) {
    return null;
  }
}

/**
 * @param {import("express").Request} req
 * @returns {Promise<object | null>}
 */
async function resolveAccessOrRefreshSession(req) {
  const accessContext = await resolveAccessSession(req);
  if (accessContext) return accessContext;
  return resolveRefreshSession(req);
}

module.exports = {
  getAccessCookie,
  getRefreshCookie,
  resolveAccessOrRefreshSession,
  resolveAccessSession,
  resolveRefreshSession,
};
