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
const {
  normalizeLowerTrim,
  isValidLocalPart,
  isValidDomain,
  parseMailbox,
} = require("../../lib/mailbox-validation");

function normStr(value) {
  return normalizeLowerTrim(value);
}

function isValidName(name) {
  return isValidLocalPart(name);
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
    const nameRaw = req.query?.name;
    const domainRaw = req.query?.domain;
    const addressRaw = req.query?.address;
    const toRaw = req.query?.to || "";
    const clientIp = getClientIp(req);

    const addressProvided = addressRaw !== undefined;

    if (addressProvided) {
      if (nameRaw !== undefined) {
        return res.status(400).json({
          error: "invalid_params",
          field: "name",
          reason: "address_incompatible_with_name",
        });
      }
      if (domainRaw !== undefined) {
        return res.status(400).json({
          error: "invalid_params",
          field: "domain",
          reason: "address_incompatible_with_domain",
        });
      }
    }

    if (!toRaw) return res.status(400).json({ error: "invalid_params", field: "to" });

    const toParsed = parseMailbox(toRaw);
    if (!toParsed) {
      return res.status(400).json({
        error: "invalid_params",
        field: "to",
        hint: "allowed local: RFC 5322 dot-atom; domain: strict DNS (RFC 1035); lowercase",
      });
    }

    let aliasName = "";
    let aliasDomain = "";
    let aliasAddress = "";
    let domainRow = null;
    let intent = "subscribe";

    if (addressProvided) {
      const addressParsed = parseMailbox(addressRaw);
      if (!addressParsed) {
        return res.status(400).json({
          error: "invalid_params",
          field: "address",
          hint: "expected: valid email address (local: RFC 5322 dot-atom; domain: strict DNS RFC 1035)",
        });
      }

      aliasName = addressParsed.local;
      aliasDomain = addressParsed.domain;
      aliasAddress = addressParsed.email;
      intent = "subscribe_address";
    } else {
      const name = normStr(nameRaw || "");
      const domainInput = normStr(domainRaw || "");

      if (!name) return res.status(400).json({ error: "invalid_params", field: "name" });

      if (!isValidName(name)) {
        return res.status(400).json({
          error: "invalid_params",
          field: "name",
          hint: "allowed: RFC 5322 dot-atom local-part; max 64",
        });
      }

      const defaultDomain = normStr(config.defaultAliasDomain || "");
      const chosenDomain = domainInput || defaultDomain;

      if (!chosenDomain) {
        return res.status(500).json({
          error: "server_misconfigured",
          field: "DEFAULT_ALIAS_DOMAIN",
        });
      }

      if (!isValidDomain(chosenDomain)) {
        const status = domainInput ? 400 : 500;
        return res.status(status).json({
          error: domainInput ? "invalid_params" : "server_misconfigured",
          field: "domain",
          hint: "allowed: strict DNS domain (a-z 0-9 hyphen dot), TLD letters >=2",
        });
      }

      aliasName = name;
      aliasDomain = chosenDomain;
      aliasAddress = `${name}@${chosenDomain}`;
    }

    if (clientIp) {
      const ban = await bansRepository.getBannedIP(clientIp);
      if (ban) return res.status(403).json({ error: "banned", ban });
    }

    if (addressProvided) {
      const banAddress = await bansRepository.getBannedEmail(aliasAddress);
      if (banAddress) return res.status(403).json({ error: "banned", ban: banAddress });

      for (const suffix of domainSuffixes(aliasDomain)) {
        const banDomain = await bansRepository.getBannedDomain(suffix);
        if (banDomain) return res.status(403).json({ error: "banned", ban: banDomain });
      }
    } else {
      const banName = await bansRepository.getBannedName(aliasName);
      if (banName) return res.status(403).json({ error: "banned", ban: banName });
    }

    const banEmail = await bansRepository.getBannedEmail(toParsed.email);
    if (banEmail) return res.status(403).json({ error: "banned", ban: banEmail });

    for (const suffix of domainSuffixes(toParsed.domain)) {
      const banDomain = await bansRepository.getBannedDomain(suffix);
      if (banDomain) return res.status(403).json({ error: "banned", ban: banDomain });
    }

    if (!addressProvided) {
      domainRow = await domainRepository.getActiveByName(aliasDomain);
      if (!domainRow) {
        return res.status(400).json({
          error: "invalid_domain",
          field: "domain",
          hint: "domain must exist in database and be active",
        });
      }
    }

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
      requestOrigin: req.get("origin") || "",
      requestReferer: req.get("referer") || req.get("referrer") || "",
      aliasName,
      aliasDomain,
      intent,
    });

    const ttlMinutes = Number(config.emailConfirmationTtlMinutes ?? 10);
    const ttl = Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes : 10;

    return res.status(200).json({
      ok: true,
      action: "subscribe",
      alias_candidate: addressProvided ? aliasAddress : `${aliasName}@${domainRow.name}`,
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
