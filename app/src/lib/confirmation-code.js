"use strict";

/**
 * @fileoverview Confirmation code helpers.
 */

const crypto = require("crypto");

const CONFIRMATION_CODE_LENGTH = 6;
const RE_CONFIRMATION_CODE = /^\d{6}$/;

/**
 * Generate a random 6-digit numeric confirmation code.
 * @returns {string}
 */
function generateConfirmationCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(CONFIRMATION_CODE_LENGTH, "0");
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeConfirmationCode(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

/**
 * @param {string} code
 * @returns {boolean}
 */
function isConfirmationCodeValid(code) {
  return RE_CONFIRMATION_CODE.test(String(code || ""));
}

module.exports = {
  CONFIRMATION_CODE_LENGTH,
  generateConfirmationCode,
  normalizeConfirmationCode,
  isConfirmationCodeValid,
};
