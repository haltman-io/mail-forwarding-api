"use strict";

/**
 * @fileoverview Admin CRUD controller for domains.
 */

const { domainRepository } = require("../../repositories/domain-repository");
const { logError } = require("../../lib/logger");
const { normalizeLowerTrim, isValidDomain } = require("../../lib/mailbox-validation");
const { parseId, parsePagination, parseOptionalBoolAsInt } = require("./helpers");

function normStr(value) {
  return normalizeLowerTrim(value);
}

/**
 * GET /admin/domains
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function listAdminDomains(req, res) {
  try {
    const paging = parsePagination(req);
    if (!paging.ok) return res.status(400).json(paging.error);

    const activeParsed = parseOptionalBoolAsInt(req.query?.active);
    if (!activeParsed.ok) return res.status(400).json({ error: "invalid_params", field: "active" });

    const filters = { active: activeParsed.value };

    const [items, total] = await Promise.all([
      domainRepository.listAll({
        limit: paging.limit,
        offset: paging.offset,
        active: filters.active,
      }),
      domainRepository.countAll(filters),
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
    logError("admin.domains.list.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * GET /admin/domains/:id
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function getAdminDomain(req, res) {
  try {
    const id = parseId(req.params?.id);
    if (!id) return res.status(400).json({ error: "invalid_params", field: "id" });

    const row = await domainRepository.getById(id);
    if (!row) return res.status(404).json({ error: "domain_not_found", id });

    return res.status(200).json({ item: row });
  } catch (err) {
    logError("admin.domains.get.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * POST /admin/domains
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function createAdminDomain(req, res) {
  try {
    const name = normStr(req.body?.name);
    if (!name) return res.status(400).json({ error: "invalid_params", field: "name" });
    if (!isValidDomain(name)) {
      return res.status(400).json({ error: "invalid_params", field: "name" });
    }

    const activeParsed = parseOptionalBoolAsInt(req.body?.active);
    if (!activeParsed.ok) return res.status(400).json({ error: "invalid_params", field: "active" });
    const active = activeParsed.value === undefined ? 1 : activeParsed.value;

    const existing = await domainRepository.getByName(name);
    if (existing) return res.status(409).json({ error: "domain_taken", name });

    const created = await domainRepository.createDomain({ name, active });
    const row = await domainRepository.getById(created.insertId);

    return res.status(201).json({
      ok: true,
      created: true,
      item: row,
    });
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "domain_taken" });
    }
    logError("admin.domains.create.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * PATCH /admin/domains/:id
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function updateAdminDomain(req, res) {
  try {
    const id = parseId(req.params?.id);
    if (!id) return res.status(400).json({ error: "invalid_params", field: "id" });

    const current = await domainRepository.getById(id);
    if (!current) return res.status(404).json({ error: "domain_not_found", id });

    const patch = {};

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "name")) {
      const name = normStr(req.body?.name);
      if (!name) return res.status(400).json({ error: "invalid_params", field: "name" });
      if (!isValidDomain(name)) {
        return res.status(400).json({ error: "invalid_params", field: "name" });
      }

      const conflict = await domainRepository.getByName(name);
      if (conflict && Number(conflict.id) !== id) {
        return res.status(409).json({ error: "domain_taken", name });
      }
      patch.name = name;
    }

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "active")) {
      const activeParsed = parseOptionalBoolAsInt(req.body?.active);
      if (!activeParsed.ok || activeParsed.value === undefined) {
        return res.status(400).json({ error: "invalid_params", field: "active" });
      }
      patch.active = activeParsed.value;
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "invalid_params", reason: "empty_patch" });
    }

    await domainRepository.updateById(id, patch);
    const row = await domainRepository.getById(id);

    return res.status(200).json({ ok: true, updated: true, item: row });
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "domain_taken" });
    }
    logError("admin.domains.update.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * DELETE /admin/domains/:id
 * Soft delete: active=0.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function deleteAdminDomain(req, res) {
  try {
    const id = parseId(req.params?.id);
    if (!id) return res.status(400).json({ error: "invalid_params", field: "id" });

    const current = await domainRepository.getById(id);
    if (!current) return res.status(404).json({ error: "domain_not_found", id });

    const disabled = await domainRepository.disableById(id);
    const row = await domainRepository.getById(id);

    return res.status(200).json({
      ok: true,
      deleted: Boolean(disabled),
      item: row,
    });
  } catch (err) {
    logError("admin.domains.delete.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

module.exports = {
  listAdminDomains,
  getAdminDomain,
  createAdminDomain,
  updateAdminDomain,
  deleteAdminDomain,
};
