"use strict";

/**
 * @fileoverview API credentials confirmation controller.
 */

const crypto = require("crypto");
const { apiTokenRequestsRepository } = require("../../repositories/api-token-requests-repository");
const { apiTokensRepository } = require("../../repositories/api-tokens-repository");
const { sha256Buffer } = require("../../services/api-credentials-email-service");
const { packIp16 } = require("../../lib/ip-pack");
const { logError } = require("../../lib/logger");
const {
  normalizeConfirmationCode,
  isConfirmationCodeValid,
} = require("../../lib/confirmation-code");

function generateApiToken64() {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * GET /api/credentials/confirm
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function confirmCredentials(req, res) {
  try {
    const token = normalizeConfirmationCode(req.query?.token || "");
    if (!token) return res.status(400).send("Missing token.");
    if (!isConfirmationCodeValid(token)) return res.status(400).send("Invalid token.");

    const tokenHash32 = sha256Buffer(token);
    const pending = await apiTokenRequestsRepository.getPendingByTokenHash(tokenHash32);

    if (!pending) return res.status(404).send("Invalid or expired token.");

    const okConfirm = await apiTokenRequestsRepository.markConfirmedById(pending.id);
    if (!okConfirm) return res.status(409).send("Token already used or expired.");

    const apiToken = generateApiToken64();
    const apiTokenHash32 = sha256Buffer(apiToken);

    const days = Number(pending.days || 0);
    const expiresAtDays = Number.isFinite(days) && days > 0 && days <= 90 ? days : 1;

    const createdIpPacked = packIp16(req.ip);
    const ua = String(req.headers["user-agent"] || "").slice(0, 255);

    await apiTokensRepository.createToken({
      ownerEmail: String(pending.email).trim().toLowerCase(),
      tokenHash32: apiTokenHash32,
      days: expiresAtDays,
      createdIpPacked,
      userAgentOrNull: ua || null,
    });

    res.set("Content-Type", "text/plain; charset=utf-8");
    return res.status(200).send(`Your API Token: ${apiToken}\n`);
  } catch (err) {
    logError("api.confirmCredentials.error", err, req);
    return res.status(500).send("Internal error.");
  }
}

module.exports = { confirmCredentials };
