"use strict";

/**
 * @fileoverview Unsubscribe controller.
 */

const { bansRepository } = require("../../repositories/bans-repository");
const { aliasRepository } = require("../../repositories/alias-repository");
const { sendEmailConfirmation } = require("../../services/email-confirmation-service");
const { logError } = require("../../lib/logger");

const RE_NAME = /^[a-z0-9](?:[a-z0-9.]{0,62}[a-z0-9])?$/;
const RE_DOMAIN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,63}$/;

function normStr(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function isValidName(value) {
  return RE_NAME.test(value);
}

function isValidDomain(value) {
  return RE_DOMAIN.test(value);
}

function parseEmailStrict(emailRaw) {
  const email = normStr(emailRaw).toLowerCase();
  if (!email || email.length > 254) return null;
  if (!RE_EMAIL.test(email)) return null;
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return { email, local, domain };
}

function getClientIp(req) {
  return req.ip || "";
}

/**
 * GET /forward/unsubscribe
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function unsubscribeAction(req, res) {
  try {
    const aliasRaw = req.query?.alias || "";
    const aliasParsed = parseEmailStrict(aliasRaw);
    const clientIp = getClientIp(req);

    if (!aliasParsed) {
      return res.status(400).json({ error: "invalid_params", field: "alias" });
    }

    const aliasName = aliasParsed.local;
    const aliasDomain = aliasParsed.domain;

    if (!isValidName(aliasName)) {
      return res.status(400).json({ error: "invalid_params", field: "alias_name" });
    }
    if (!isValidDomain(aliasDomain)) {
      return res.status(400).json({ error: "invalid_params", field: "alias_domain" });
    }

    if (clientIp) {
      const bannedIp = await bansRepository.isBannedIP(clientIp);
      if (bannedIp) return res.status(403).json({ error: "banned", type: "ip" });
    }

    const address = `${aliasName}@${aliasDomain}`;
    const aliasRow = await aliasRepository.getByAddress(address);

    if (!aliasRow || !aliasRow.id) {
      return res.status(404).json({ error: "alias_not_found", alias: address });
    }

    if (aliasRow.active === 0 || aliasRow.active === false) {
      return res.status(400).json({ error: "alias_inactive", alias: address });
    }

    const gotoEmail = String(aliasRow.goto || "").trim().toLowerCase();
    const gotoParsed = parseEmailStrict(gotoEmail);

    if (!gotoParsed) {
      return res.status(500).json({ error: "invalid_goto_on_alias", alias: address });
    }

    const bannedEmail = await bansRepository.isBannedEmail(gotoParsed.email);
    if (bannedEmail) return res.status(403).json({ error: "banned", type: "email" });

    const domainParts = gotoParsed.domain.split(".");
    for (let i = 0; i < domainParts.length - 1; i++) {
      const suffix = domainParts.slice(i).join(".");
      const bannedDomain = await bansRepository.isBannedDomain(suffix);
      if (bannedDomain) return res.status(403).json({ error: "banned", type: "domain", value: suffix });
    }

    const result = await sendEmailConfirmation({
      email: gotoParsed.email,
      requestIpText: req.ip,
      userAgent: String(req.headers["user-agent"] || ""),
      aliasName,
      aliasDomain,
      intent: "unsubscribe",
    });

    return res.status(200).json({
      ok: true,
      action: "unsubscribe",
      alias: address,
      sent: Boolean(result.sent),
      reason: result.reason || undefined,
      ttl_minutes: result.ttl_minutes,
    });
  } catch (err) {
    logError("unsubscribe.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

module.exports = { unsubscribeAction };
