"use strict";

/**
 * @fileoverview API alias controller.
 */

const { domainRepository } = require("../../repositories/domain-repository");
const { aliasRepository } = require("../../repositories/alias-repository");
const { logError } = require("../../lib/logger");

const RE_NAME = /^[a-z0-9](?:[a-z0-9.]{0,62}[a-z0-9])?$/;
const RE_DOMAIN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

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

function parseAliasEmail(raw) {
  const value = normStr(raw);
  const at = value.indexOf("@");
  if (at <= 0) return null;
  if (value.indexOf("@", at + 1) !== -1) return null;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (!isValidName(local)) return null;
  if (!isValidDomain(domain)) return null;
  return { address: `${local}@${domain}`, local, domain };
}

/**
 * GET /api/alias/list
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function listAliases(req, res) {
  try {
    const owner = req.api_token?.owner_email;
    const rows = await aliasRepository.listByGoto(owner);
    return res.status(200).json(rows);
  } catch (err) {
    logError("api.listAliases.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * POST /api/alias/create
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function createAlias(req, res) {
  try {
    const owner = req.api_token?.owner_email;

    const handleRaw = req.body?.alias_handle ?? req.query?.alias_handle;
    const domainRaw = req.body?.alias_domain ?? req.query?.alias_domain;

    const aliasHandle = normStr(handleRaw);
    const aliasDomain = normStr(domainRaw);

    if (!aliasHandle) return res.status(400).json({ error: "invalid_params", field: "alias_handle" });
    if (!aliasDomain) return res.status(400).json({ error: "invalid_params", field: "alias_domain" });

    if (!isValidName(aliasHandle)) {
      return res.status(400).json({ error: "invalid_params", field: "alias_handle" });
    }
    if (!isValidDomain(aliasDomain)) {
      return res.status(400).json({ error: "invalid_params", field: "alias_domain" });
    }

    const domainRow = await domainRepository.getActiveByName(aliasDomain);
    if (!domainRow) {
      return res.status(400).json({ error: "invalid_domain", field: "alias_domain" });
    }

    const address = `${aliasHandle}@${aliasDomain}`;

    const created = await aliasRepository.createIfNotExists({
      address,
      goto: owner,
      domainId: domainRow.id,
      active: 1,
    });

    if (created.alreadyExists) {
      return res.status(409).json({ ok: false, error: "alias_taken", address });
    }

    return res.status(200).json({ ok: true, created: true, address, goto: owner });
  } catch (err) {
    logError("api.createAlias.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * POST /api/alias/delete
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function deleteAlias(req, res) {
  try {
    const owner = req.api_token?.owner_email;

    const aliasRaw = req.body?.alias ?? req.query?.alias;
    const parsed = parseAliasEmail(aliasRaw);
    if (!parsed) return res.status(400).json({ error: "invalid_params", field: "alias" });

    const row = await aliasRepository.getByAddress(parsed.address);
    if (!row) return res.status(404).json({ error: "alias_not_found", alias: parsed.address });

    const goto = String(row.goto || "").trim().toLowerCase();
    if (goto !== owner) return res.status(403).json({ error: "forbidden" });

    const result = await aliasRepository.deleteByAddress(parsed.address);
    if (!result.deleted) return res.status(404).json({ error: "alias_not_found", alias: parsed.address });

    return res.status(200).json({ ok: true, deleted: true, alias: parsed.address });
  } catch (err) {
    logError("api.deleteAlias.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

module.exports = { listAliases, createAlias, deleteAlias };
