"use strict";

/**
 * @fileoverview Subscribe controller.
 */

const { config } = require("../../config");
const { domainRepository } = require("../../repositories/domain-repository");
const { bansRepository } = require("../../repositories/bans-repository");
const { aliasRepository } = require("../../repositories/alias-repository");
const { sendEmailConfirmation } = require("../../services/email-confirmation-service");
const { logError } = require("../../lib/logger");

const RE_NAME = /^[a-z0-9](?:[a-z0-9.]{0,62}[a-z0-9])?$/;
const RE_DOMAIN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const RE_EMAIL_LOCAL = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const MAX_EMAIL_LEN = 254;

function normStr(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function isValidName(name) {
  return RE_NAME.test(name);
}

function isValidDomain(domain) {
  return RE_DOMAIN.test(domain);
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
  if (!isValidDomain(domain)) return null;

  return { email: value, local, domain };
}

function domainSuffixes(domain) {
  const parts = domain.split(".");
  const out = [];
  for (let i = 0; i < parts.length - 1; i++) {
    out.push(parts.slice(i).join("."));
  }
  return out;
}

function getClientIp(req) {
  return req.ip || "";
}

/**
 * GET /forward/subscribe
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function subscribeAction(req, res) {
  try {
    const name = normStr(req.query?.name || "");
    const toRaw = req.query?.to || "";
    const domainInput = normStr(req.query?.domain || "");
    const clientIp = getClientIp(req);

    if (!name) return res.status(400).json({ error: "invalid_params", field: "name" });
    if (!toRaw) return res.status(400).json({ error: "invalid_params", field: "to" });

    if (!isValidName(name)) {
      return res.status(400).json({
        error: "invalid_params",
        field: "name",
        hint: "allowed: a-z 0-9 dot; cannot start/end with dot; max 64",
      });
    }

    const toParsed = parseEmailStrict(toRaw);
    if (!toParsed) {
      return res.status(400).json({
        error: "invalid_params",
        field: "to",
        hint: "allowed local: a-z 0-9 dot underscore hyphen; domain: strict DNS; lowercase",
      });
    }

    const defaultDomain = normStr(config.defaultAliasDomain || "");
    const chosenDomain = domainInput || defaultDomain;

    if (!chosenDomain) {
      return res.status(500).json({ error: "server_misconfigured", field: "DEFAULT_ALIAS_DOMAIN" });
    }

    if (!isValidDomain(chosenDomain)) {
      const status = domainInput ? 400 : 500;
      return res.status(status).json({
        error: domainInput ? "invalid_params" : "server_misconfigured",
        field: "domain",
        hint: "allowed: strict DNS domain (a-z 0-9 hyphen dot), TLD letters >=2",
      });
    }

    if (clientIp) {
      const ban = await bansRepository.getBannedIP(clientIp);
      if (ban) return res.status(403).json({ error: "banned", ban });
    }

    const banName = await bansRepository.getBannedName(name);
    if (banName) return res.status(403).json({ error: "banned", ban: banName });

    const banEmail = await bansRepository.getBannedEmail(toParsed.email);
    if (banEmail) return res.status(403).json({ error: "banned", ban: banEmail });

    for (const suffix of domainSuffixes(toParsed.domain)) {
      const banDomain = await bansRepository.getBannedDomain(suffix);
      if (banDomain) return res.status(403).json({ error: "banned", ban: banDomain });
    }

    const domainRow = await domainRepository.getActiveByName(chosenDomain);
    if (!domainRow) {
      return res.status(400).json({
        error: "invalid_domain",
        field: "domain",
        hint: "domain must exist in database and be active",
      });
    }

    const aliasAddress = `${name}@${chosenDomain}`;

    const taken = await aliasRepository.existsByAddress(aliasAddress);
    if (taken) {
      return res.status(409).json({
        ok: false,
        error: "alias_taken",
        address: aliasAddress,
      });
    }

    const toIsAlias = await aliasRepository.existsByAddress(toParsed.email);
    if (toIsAlias) {
      return res.status(400).json({
        ok: false,
        error: "invalid_params",
        field: "to",
        reason: "destination_cannot_be_an_existing_alias",
        to: toParsed.email,
      });
    }

    for (const suffix of domainSuffixes(toParsed.domain)) {
      const isManaged = await domainRepository.existsActive(suffix);
      if (isManaged) {
        return res.status(400).json({
          ok: false,
          error: "invalid_params",
          field: "to",
          reason: "destination_cannot_use_managed_domain",
          to: toParsed.email,
          managed_domain_match: suffix,
        });
      }
    }

    if (toParsed.email === aliasAddress) {
      return res.status(400).json({
        ok: false,
        error: "invalid_params",
        field: "to",
        reason: "destination_cannot_be_the_same_as_alias",
        to: toParsed.email,
        alias: aliasAddress,
      });
    }

    const result = await sendEmailConfirmation({
      email: toParsed.email,
      requestIpText: req.ip,
      userAgent: String(req.headers["user-agent"] || ""),
      aliasName: name,
      aliasDomain: chosenDomain,
    });

    const ttlMinutes = Number(config.emailConfirmationTtlMinutes ?? 10);
    const ttl = Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes : 10;

    return res.status(200).json({
      ok: true,
      action: "subscribe",
      alias_candidate: `${name}@${domainRow.name}`,
      to: toParsed.email,
      confirmation: {
        sent: Boolean(result.sent),
        ttl_minutes: ttl,
      },
    });
  } catch (err) {
    logError("subscribe.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

module.exports = {
  subscribeAction,
};
