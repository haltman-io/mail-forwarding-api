"use strict";

/**
 * @fileoverview Normalization and validation for auth identifiers.
 */

const { parseMailbox, normalizeLowerTrim } = require("./mailbox-validation");

const USERNAME_MIN_LENGTH = 3;
const USERNAME_MAX_LENGTH = 64;
const RE_USERNAME = /^(?=.{3,64}$)[a-z0-9](?:[a-z0-9._-]{1,62}[a-z0-9])?$/;

/**
 * @param {unknown} raw
 * @returns {string | null}
 */
function normalizeEmailStrict(raw) {
  const parsed = parseMailbox(raw);
  if (!parsed) return null;
  if (parsed.email.length > 254) return null;
  return parsed.email;
}

/**
 * @param {unknown} raw
 * @returns {string | null}
 */
function normalizeUsername(raw) {
  const value = normalizeLowerTrim(raw);
  if (!value) return null;
  if (value.includes("@")) return null;
  if (!RE_USERNAME.test(value)) return null;
  return value;
}

/**
 * @param {unknown} raw
 * @returns {{ type: "email" | "username", value: string } | null}
 */
function parseIdentifier(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;

  if (value.includes("@")) {
    const email = normalizeEmailStrict(value);
    if (!email) return null;
    return { type: "email", value: email };
  }

  const username = normalizeUsername(value);
  if (!username) return null;
  return { type: "username", value: username };
}

module.exports = {
  USERNAME_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  normalizeEmailStrict,
  normalizeUsername,
  parseIdentifier,
};
