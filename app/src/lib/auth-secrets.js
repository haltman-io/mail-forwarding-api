"use strict";

/**
 * @fileoverview Opaque auth token helpers.
 */

const crypto = require("crypto");

const DEFAULT_OPAQUE_TOKEN_BYTES = 32;
const RE_OPAQUE_TOKEN = /^[A-Za-z0-9_-]{32,512}$/;

/**
 * @param {unknown} value
 * @returns {Buffer}
 */
function sha256Buffer(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest();
}

/**
 * @param {number} [bytes]
 * @returns {string}
 */
function createOpaqueToken(bytes = DEFAULT_OPAQUE_TOKEN_BYTES) {
  return crypto.randomBytes(bytes).toString("base64url");
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeOpaqueToken(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isOpaqueTokenFormatValid(value) {
  return RE_OPAQUE_TOKEN.test(normalizeOpaqueToken(value));
}

module.exports = {
  DEFAULT_OPAQUE_TOKEN_BYTES,
  sha256Buffer,
  createOpaqueToken,
  normalizeOpaqueToken,
  isOpaqueTokenFormatValid,
};
