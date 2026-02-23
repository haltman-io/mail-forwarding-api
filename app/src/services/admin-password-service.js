"use strict";

/**
 * @fileoverview Admin password hashing and verification (Argon2id).
 */

const argon2 = require("argon2");
const { config } = require("../config");

const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_LEN = 256;

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const intNum = Math.floor(num);
  if (intNum < min) return min;
  if (intNum > max) return max;
  return intNum;
}

/**
 * Ensure password is a bounded plain string.
 * @param {unknown} value
 * @returns {string}
 */
function assertPlainPassword(value) {
  if (typeof value !== "string") throw new Error("invalid_password");
  if (value.length < MIN_PASSWORD_LEN || value.length > MAX_PASSWORD_LEN) {
    throw new Error("invalid_password");
  }
  return value;
}

function getArgon2idOptions() {
  return {
    type: argon2.argon2id,
    timeCost: clampInt(config.adminAuthArgon2TimeCost, 2, 12, 4),
    memoryCost: clampInt(config.adminAuthArgon2MemoryCost, 32 * 1024, 1024 * 1024, 128 * 1024),
    parallelism: clampInt(config.adminAuthArgon2Parallelism, 1, 4, 1),
    hashLength: clampInt(config.adminAuthArgon2HashLength, 16, 64, 32),
    saltLength: clampInt(config.adminAuthArgon2SaltLength, 16, 64, 16),
  };
}

/**
 * Hash admin password with Argon2id and random per-user salt.
 * @param {string} plainPassword
 * @returns {Promise<string>}
 */
async function hashAdminPassword(plainPassword) {
  const normalizedPassword = assertPlainPassword(plainPassword);
  return argon2.hash(normalizedPassword, getArgon2idOptions());
}

/**
 * Verify admin password using stored Argon2 hash.
 * @param {string} storedHash
 * @param {string} plainPassword
 * @returns {Promise<boolean>}
 */
async function verifyAdminPassword(storedHash, plainPassword) {
  if (typeof storedHash !== "string" || !storedHash.trim()) return false;
  const normalizedPassword = assertPlainPassword(plainPassword);
  return argon2.verify(storedHash, normalizedPassword);
}

module.exports = {
  MIN_PASSWORD_LEN,
  MAX_PASSWORD_LEN,
  hashAdminPassword,
  verifyAdminPassword,
};
