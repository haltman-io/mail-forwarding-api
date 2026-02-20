"use strict";

/**
 * @fileoverview Confirm controller.
 */

const crypto = require("crypto");

const { emailConfirmationsRepository } = require("../../repositories/email-confirmations-repository");
const { domainRepository } = require("../../repositories/domain-repository");
const { aliasRepository } = require("../../repositories/alias-repository");
const { logError } = require("../../lib/logger");
const {
  normalizeConfirmationCode,
  isConfirmationCodeValid,
} = require("../../lib/confirmation-code");

/**
 * @param {string} value
 * @returns {Buffer}
 */
function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest();
}

/**
 * GET /forward/confirm?token=...
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function confirmAction(req, res) {
  try {
    const token = normalizeConfirmationCode(req.query?.token || "");
    if (!isConfirmationCodeValid(token)) {
      return res.status(400).json({ ok: false, error: "invalid_token" });
    }

    const tokenHash32 = sha256Buffer(token);
    const pending = await emailConfirmationsRepository.getPendingByTokenHash(tokenHash32);
    if (!pending) {
      return res.status(400).json({ ok: false, error: "invalid_or_expired" });
    }

    const toEmail = String(pending.email || "").trim().toLowerCase();
    const intent = String(pending.intent || "subscribe").trim().toLowerCase();
    const aliasName = String(pending.alias_name || "").trim().toLowerCase();
    const aliasDomain = String(pending.alias_domain || "").trim().toLowerCase();

    if (!toEmail || !aliasName || !aliasDomain) {
      return res.status(500).json({
        ok: false,
        error: "confirmation_payload_missing",
      });
    }

    const confirmed = await emailConfirmationsRepository.markConfirmedById(pending.id);
    if (!confirmed) {
      return res.status(400).json({ ok: false, error: "invalid_or_expired" });
    }

    const address = `${aliasName}@${aliasDomain}`;

    if (intent === "unsubscribe") {
      const row = await aliasRepository.getByAddress(address);
      if (!row || !row.id) {
        return res.status(404).json({ ok: false, error: "alias_not_found", address });
      }

      const currentGoto = String(row.goto || "").trim().toLowerCase();
      if (currentGoto && currentGoto !== toEmail) {
        return res.status(409).json({
          ok: false,
          error: "alias_owner_changed",
          address,
        });
      }

      const del = await aliasRepository.deleteByAddress(address);

      return res.status(200).json({
        ok: true,
        confirmed: true,
        intent,
        removed: Boolean(del.deleted),
        address,
      });
    }

    const isAddressIntent = intent === "subscribe_address";
    if (intent !== "subscribe" && !isAddressIntent) {
      return res.status(400).json({ ok: false, error: "unsupported_intent", intent });
    }

    let domainRow = null;
    if (!isAddressIntent) {
      domainRow = await domainRepository.getActiveByName(aliasDomain);
      if (!domainRow) {
        return res.status(400).json({
          ok: false,
          error: "invalid_domain",
          domain: aliasDomain,
        });
      }
    }

    const existing = await aliasRepository.getByAddress(address);
    if (existing && existing.id) {
      return res.status(200).json({
        ok: true,
        confirmed: true,
        intent,
        created: false,
        reason: "already_exists",
        address,
        goto: toEmail,
      });
    }

    const createPayload = {
      address,
      goto: toEmail,
      active: true,
    };

    if (domainRow) createPayload.domainId = domainRow.id;

    const created = await aliasRepository.createIfNotExists(createPayload);

    return res.status(200).json({
      ok: true,
      confirmed: true,
      intent,
      created: Boolean(created.created),
      address,
      goto: toEmail,
    });
  } catch (err) {
    logError("confirm.error", err, req);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
}

module.exports = { confirmAction };
