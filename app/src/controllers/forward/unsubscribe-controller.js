"use strict";

/**
 * @fileoverview Unsubscribe controller.
 */

const { bansRepository } = require("../../repositories/bans-repository");
const { aliasRepository } = require("../../repositories/alias-repository");
const { sendEmailConfirmation } = require("../../services/email-confirmation-service");
const { logError } = require("../../lib/logger");
const {
  MAX_EMAIL_LENGTH,
  normalizeLowerTrim,
  isValidLocalPart,
  isValidDomain,
  parseMailbox,
} = require("../../lib/mailbox-validation");

function normStr(value) {
  return normalizeLowerTrim(value);
}

function isValidName(value) {
  return isValidLocalPart(value);
}

function parseEmailLoose(emailRaw) {
  const email = normStr(emailRaw).toLowerCase();
  if (!email || email.length > MAX_EMAIL_LENGTH) return null;
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1 || email.indexOf("@") !== at) return null;
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
    const aliasParsed = parseEmailLoose(aliasRaw);
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
    const gotoParsed = parseMailbox(gotoEmail);

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
      requestOrigin: req.get("origin") || "",
      requestReferer: req.get("referer") || req.get("referrer") || "",
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
