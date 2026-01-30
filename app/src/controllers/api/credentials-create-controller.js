"use strict";

/**
 * @fileoverview API credentials creation controller.
 */

const { bansRepository } = require("../../repositories/bans-repository");
const { sendApiTokenRequestEmail } = require("../../services/api-credentials-email-service");
const { logError } = require("../../lib/logger");

const MAX_EMAIL_LEN = 254;
const RE_DOMAIN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const RE_EMAIL_LOCAL = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

function normStr(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function parseEmailStrict(email) {
  const value = normStr(email);
  if (!value || value.length > MAX_EMAIL_LEN) return null;

  const at = value.indexOf("@");
  if (at <= 0) return null;
  if (value.indexOf("@", at + 1) !== -1) return null;

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);

  if (!RE_EMAIL_LOCAL.test(local)) return null;
  if (!RE_DOMAIN.test(domain)) return null;

  return { email: value, local, domain };
}

function parseDays(raw) {
  const num = Number(String(raw ?? "").trim());
  if (!Number.isInteger(num)) return null;
  if (num <= 0 || num > 90) return null;
  return num;
}

/**
 * POST /api/credentials/create
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function createCredentials(req, res) {
  try {
    const emailRaw = req.body?.email ?? req.query?.email;
    const daysRaw = req.body?.days ?? req.query?.days;

    const parsedEmail = parseEmailStrict(emailRaw);
    if (!parsedEmail) return res.status(400).json({ error: "invalid_params", field: "email" });

    const days = parseDays(daysRaw);
    if (!days) return res.status(400).json({ error: "invalid_params", field: "days", hint: "integer 1..90" });

    if (req.ip) {
      const ban = await bansRepository.getBannedIP(req.ip);
      if (ban) return res.status(403).json({ error: "banned", ban });
    }

    const banEmail = await bansRepository.getBannedEmail(parsedEmail.email);
    if (banEmail) return res.status(403).json({ error: "banned", ban: banEmail });

    const result = await sendApiTokenRequestEmail({
      email: parsedEmail.email,
      days,
      requestIpText: req.ip,
      userAgent: String(req.headers["user-agent"] || ""),
    });

    return res.status(200).json({
      ok: true,
      action: "api_credentials_create",
      email: parsedEmail.email,
      days,
      confirmation: {
        sent: Boolean(result.sent),
        ttl_minutes: Number(result.ttl_minutes ?? 15),
      },
    });
  } catch (err) {
    logError("api.createCredentials.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

module.exports = { createCredentials };
