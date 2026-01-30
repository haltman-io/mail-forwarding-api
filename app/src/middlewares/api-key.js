"use strict";

/**
 * @fileoverview API key authentication middleware.
 */

const crypto = require("crypto");
const { apiTokensRepository } = require("../repositories/api-tokens-repository");
const { logError } = require("../lib/logger");

const RE_API_KEY = /^[a-z0-9]{64}$/;

/**
 * @param {string} value
 * @returns {Buffer}
 */
function sha256Buffer(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest();
}

/**
 * Require a valid API token via X-API-Key header.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function requireApiKey(req, res, next) {
  try {
    const raw = String(req.header("X-API-Key") || "").trim().toLowerCase();
    if (!raw) return res.status(401).json({ error: "missing_api_key" });

    if (!RE_API_KEY.test(raw)) {
      return res.status(401).json({ error: "invalid_api_key_format" });
    }

    const tokenHash32 = sha256Buffer(raw);
    const tokenRow = await apiTokensRepository.getActiveByTokenHash(tokenHash32);

    if (!tokenRow) return res.status(401).json({ error: "invalid_or_expired_api_key" });

    req.api_token = {
      id: tokenRow.id,
      owner_email: tokenRow.owner_email,
    };

    apiTokensRepository.touchLastUsed(tokenRow.id).catch(() => {});
    return next();
  } catch (err) {
    logError("api.auth.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

module.exports = { requireApiKey };
