"use strict";

/**
 * @fileoverview CSRF token derivation for auth session families.
 */

const crypto = require("crypto");
const { config } = require("../config");

function getCsrfSecret() {
  const secret = String(config.authCsrfSecret || "").trim();
  if (!secret) throw new Error("missing_AUTH_CSRF_SECRET");
  return secret;
}

/**
 * @param {string} sessionFamilyId
 * @returns {string}
 */
function deriveCsrfToken(sessionFamilyId) {
  return crypto
    .createHmac("sha256", getCsrfSecret())
    .update(String(sessionFamilyId || ""), "utf8")
    .digest("base64url");
}

/**
 * @param {import("express").Request} req
 * @returns {string}
 */
function readCsrfHeader(req) {
  return String(req?.header?.("X-CSRF-Token") || "").trim();
}

/**
 * @param {string} sessionFamilyId
 * @param {string} providedToken
 * @returns {boolean}
 */
function isCsrfTokenValid(sessionFamilyId, providedToken) {
  const expected = deriveCsrfToken(sessionFamilyId);
  const actual = String(providedToken || "").trim();
  if (!expected || !actual) return false;

  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(actual, "utf8");
  if (expectedBuf.length !== actualBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

module.exports = {
  deriveCsrfToken,
  readCsrfHeader,
  isCsrfTokenValid,
};
