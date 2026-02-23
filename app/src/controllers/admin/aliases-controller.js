"use strict";

/**
 * @fileoverview Admin CRUD controller for aliases.
 */

const { aliasRepository } = require("../../repositories/alias-repository");
const { domainRepository } = require("../../repositories/domain-repository");
const { logError } = require("../../lib/logger");
const {
  normalizeLowerTrim,
  parseMailbox,
} = require("../../lib/mailbox-validation");
const {
  findActiveDomainBan,
  findActiveEmailOrDomainBan,
  findActiveNameBan,
} = require("../../lib/ban-policy");
const { parseId, parsePagination, parseOptionalBoolAsInt } = require("./helpers");

function normStr(value) {
  return normalizeLowerTrim(value);
}

function parseSearchTerm(raw) {
  const value = normStr(raw);
  return value || null;
}

/**
 * GET /admin/aliases
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function listAdminAliases(req, res) {
  try {
    const paging = parsePagination(req);
    if (!paging.ok) return res.status(400).json(paging.error);

    const activeParsed = parseOptionalBoolAsInt(req.query?.active);
    if (!activeParsed.ok) return res.status(400).json({ error: "invalid_params", field: "active" });

    const gotoRaw = req.query?.goto;
    const domainRaw = req.query?.domain;
    const handleRaw = req.query?.handle;
    const addressRaw = req.query?.address;

    const filters = { active: activeParsed.value };

    if (gotoRaw !== undefined) {
      const goto = parseSearchTerm(gotoRaw);
      if (!goto) return res.status(400).json({ error: "invalid_params", field: "goto" });
      filters.goto = goto;
    }

    if (domainRaw !== undefined) {
      const domain = parseSearchTerm(domainRaw);
      if (!domain) {
        return res.status(400).json({ error: "invalid_params", field: "domain" });
      }
      filters.domain = domain;
    }

    if (handleRaw !== undefined) {
      const handle = parseSearchTerm(handleRaw);
      if (!handle) {
        return res.status(400).json({ error: "invalid_params", field: "handle" });
      }
      filters.handle = handle;
    }

    if (addressRaw !== undefined) {
      const address = parseSearchTerm(addressRaw);
      if (!address) return res.status(400).json({ error: "invalid_params", field: "address" });
      filters.address = address;
    }

    const [items, total] = await Promise.all([
      aliasRepository.listAll({
        limit: paging.limit,
        offset: paging.offset,
        ...filters,
      }),
      aliasRepository.countAll(filters),
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
    logError("admin.aliases.list.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * GET /admin/aliases/:id
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function getAdminAlias(req, res) {
  try {
    const id = parseId(req.params?.id);
    if (!id) return res.status(400).json({ error: "invalid_params", field: "id" });

    const row = await aliasRepository.getById(id);
    if (!row) return res.status(404).json({ error: "alias_not_found", id });

    return res.status(200).json({ item: row });
  } catch (err) {
    logError("admin.aliases.get.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * POST /admin/aliases
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function createAdminAlias(req, res) {
  try {
    const addressParsed = parseMailbox(req.body?.address);
    if (!addressParsed) return res.status(400).json({ error: "invalid_params", field: "address" });

    const gotoParsed = parseMailbox(req.body?.goto);
    if (!gotoParsed) return res.status(400).json({ error: "invalid_params", field: "goto" });

    const activeParsed = parseOptionalBoolAsInt(req.body?.active);
    if (!activeParsed.ok) return res.status(400).json({ error: "invalid_params", field: "active" });
    const active = activeParsed.value === undefined ? 1 : activeParsed.value;

    const banName = await findActiveNameBan(addressParsed.local);
    if (banName) return res.status(403).json({ error: "banned", ban: banName });

    const banAliasDomain = await findActiveDomainBan(addressParsed.domain);
    if (banAliasDomain) return res.status(403).json({ error: "banned", ban: banAliasDomain });

    const banGoto = await findActiveEmailOrDomainBan(gotoParsed.email);
    if (banGoto) return res.status(403).json({ error: "banned", ban: banGoto });

    const reservedHandle = await aliasRepository.existsReservedHandle(addressParsed.local);
    if (reservedHandle) {
      return res.status(409).json({
        ok: false,
        error: "alias_taken",
        address: addressParsed.email,
      });
    }

    const domainRow = await domainRepository.getActiveByName(addressParsed.domain);
    if (!domainRow) {
      return res.status(400).json({
        error: "invalid_domain",
        field: "address",
      });
    }

    const taken = await aliasRepository.existsByAddress(addressParsed.email);
    if (taken) {
      return res.status(409).json({
        ok: false,
        error: "alias_taken",
        address: addressParsed.email,
      });
    }

    const created = await aliasRepository.createAlias({
      address: addressParsed.email,
      goto: gotoParsed.email,
      active,
      domainId: domainRow.id,
    });

    const row = await aliasRepository.getByAddress(addressParsed.email);

    return res.status(201).json({
      ok: true,
      created: true,
      id: created.insertId,
      item: row,
    });
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ ok: false, error: "alias_taken" });
    }
    logError("admin.aliases.create.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * PATCH /admin/aliases/:id
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function updateAdminAlias(req, res) {
  try {
    const id = parseId(req.params?.id);
    if (!id) return res.status(400).json({ error: "invalid_params", field: "id" });

    const current = await aliasRepository.getById(id);
    if (!current) return res.status(404).json({ error: "alias_not_found", id });

    const patch = {};
    let nextAddress = String(current.address || "").trim().toLowerCase();
    let nextGoto = String(current.goto || "").trim().toLowerCase();
    let addressChanged = false;
    let gotoChanged = false;

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "address")) {
      const addressParsed = parseMailbox(req.body?.address);
      if (!addressParsed) return res.status(400).json({ error: "invalid_params", field: "address" });

      const currentAddress = String(current.address || "").trim().toLowerCase();
      if (addressParsed.email !== currentAddress) {
        const reservedHandle = await aliasRepository.existsReservedHandle(addressParsed.local);
        if (reservedHandle) {
          return res.status(409).json({
            ok: false,
            error: "alias_taken",
            address: addressParsed.email,
          });
        }

        const domainRow = await domainRepository.getActiveByName(addressParsed.domain);
        if (!domainRow) {
          return res.status(400).json({ error: "invalid_domain", field: "address" });
        }

        const existing = await aliasRepository.getByAddress(addressParsed.email);
        if (existing && Number(existing.id) !== id) {
          return res.status(409).json({
            ok: false,
            error: "alias_taken",
            address: addressParsed.email,
          });
        }
      }

      patch.address = addressParsed.email;
      nextAddress = addressParsed.email;
      addressChanged = true;
    }

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "goto")) {
      const gotoParsed = parseMailbox(req.body?.goto);
      if (!gotoParsed) return res.status(400).json({ error: "invalid_params", field: "goto" });
      patch.goto = gotoParsed.email;
      nextGoto = gotoParsed.email;
      gotoChanged = true;
    }

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "active")) {
      const activeParsed = parseOptionalBoolAsInt(req.body?.active);
      if (!activeParsed.ok || activeParsed.value === undefined) {
        return res.status(400).json({ error: "invalid_params", field: "active" });
      }
      patch.active = activeParsed.value;
    }

    const nextActive =
      patch.active === 0 || patch.active === 1 ? patch.active : Number(current.active || 0);

    if (addressChanged || gotoChanged || nextActive === 1) {
      const addressParsed = parseMailbox(nextAddress);
      if (!addressParsed) return res.status(500).json({ error: "invalid_current_state", field: "address" });

      const gotoParsed = parseMailbox(nextGoto);
      if (!gotoParsed) return res.status(500).json({ error: "invalid_current_state", field: "goto" });

      const banName = await findActiveNameBan(addressParsed.local);
      if (banName) return res.status(403).json({ error: "banned", ban: banName });

      const banAliasDomain = await findActiveDomainBan(addressParsed.domain);
      if (banAliasDomain) return res.status(403).json({ error: "banned", ban: banAliasDomain });

      const banGoto = await findActiveEmailOrDomainBan(gotoParsed.email);
      if (banGoto) return res.status(403).json({ error: "banned", ban: banGoto });
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "invalid_params", reason: "empty_patch" });
    }

    await aliasRepository.updateById(id, patch);
    const row = await aliasRepository.getById(id);

    return res.status(200).json({ ok: true, updated: true, item: row });
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ ok: false, error: "alias_taken" });
    }
    logError("admin.aliases.update.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * DELETE /admin/aliases/:id
 * Soft delete: active=0.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function deleteAdminAlias(req, res) {
  try {
    const id = parseId(req.params?.id);
    if (!id) return res.status(400).json({ error: "invalid_params", field: "id" });

    const current = await aliasRepository.getById(id);
    if (!current) return res.status(404).json({ error: "alias_not_found", id });

    const disabled = await aliasRepository.disableById(id);
    const row = await aliasRepository.getById(id);

    return res.status(200).json({
      ok: true,
      deleted: Boolean(disabled),
      item: row,
    });
  } catch (err) {
    logError("admin.aliases.delete.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

module.exports = {
  listAdminAliases,
  getAdminAlias,
  createAdminAlias,
  updateAdminAlias,
  deleteAdminAlias,
};
