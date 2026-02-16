"use strict";

/**
 * @fileoverview API alias controller.
 */

const { domainRepository } = require("../../repositories/domain-repository");
const { aliasRepository } = require("../../repositories/alias-repository");
const { activityRepository } = require("../../repositories/activity-repository");
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

function parseAliasEmail(raw) {
  const parsed = parseMailbox(raw);
  if (!parsed) return null;
  return { address: parsed.email, local: parsed.local, domain: parsed.domain };
}

function parsePagination(req, { defaultLimit = 50, maxLimit = 200 } = {}) {
  const limitRaw = req.query?.limit;
  const offsetRaw = req.query?.offset;

  const limitNum = limitRaw === undefined ? defaultLimit : Number(limitRaw);
  const offsetNum = offsetRaw === undefined ? 0 : Number(offsetRaw);

  if (!Number.isInteger(limitNum) || limitNum <= 0) {
    return { ok: false, error: { error: "invalid_params", field: "limit" } };
  }
  if (!Number.isInteger(offsetNum) || offsetNum < 0) {
    return { ok: false, error: { error: "invalid_params", field: "offset" } };
  }

  return {
    ok: true,
    limit: Math.min(limitNum, maxLimit),
    offset: offsetNum,
  };
}

/**
 * GET /api/alias/list
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function listAliases(req, res) {
  try {
    const owner = req.api_token?.owner_email;
    const paging = parsePagination(req);
    if (!paging.ok) return res.status(400).json(paging.error);

    const [items, total] = await Promise.all([
      aliasRepository.listByGoto(owner, { limit: paging.limit, offset: paging.offset }),
      aliasRepository.countByGoto(owner),
    ]);

    return res.status(200).json({
      items,
      pagination: {
        total,
        limit: paging.limit,
        offset: paging.offset,
      },
    });
  } catch (err) {
    logError("api.listAliases.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * GET /api/alias/stats
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function aliasStats(req, res) {
  try {
    const owner = req.api_token?.owner_email;
    const stats = await aliasRepository.getStatsByGoto(owner);
    return res.status(200).json(stats);
  } catch (err) {
    logError("api.aliasStats.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * GET /api/activity
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function getActivity(req, res) {
  try {
    const owner = req.api_token?.owner_email;
    const paging = parsePagination(req, { defaultLimit: 50, maxLimit: 200 });
    if (!paging.ok) return res.status(400).json(paging.error);

    const items = await activityRepository.listByOwner(owner, {
      limit: paging.limit,
      offset: paging.offset,
    });

    return res.status(200).json({
      items,
      pagination: {
        limit: paging.limit,
        offset: paging.offset,
      },
    });
  } catch (err) {
    logError("api.getActivity.error", err, req);
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

module.exports = { listAliases, aliasStats, getActivity, createAlias, deleteAlias };
