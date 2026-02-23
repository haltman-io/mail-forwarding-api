"use strict";

/**
 * @fileoverview Admin CRUD controller for alias handles (catch-all local-part rules).
 */

const { aliasHandlesRepository } = require("../../repositories/alias-handles-repository");
const { logError } = require("../../lib/logger");
const { normalizeLowerTrim, isValidLocalPart, parseMailbox } = require("../../lib/mailbox-validation");
const {
  findActiveEmailOrDomainBan,
  findActiveNameBan,
} = require("../../lib/ban-policy");
const { parseId, parsePagination, parseOptionalBoolAsInt } = require("./helpers");

function parseHandleStrict(raw) {
  const handle = normalizeLowerTrim(raw);
  if (!handle) return null;
  if (!isValidLocalPart(handle)) return null;
  return handle;
}

function parseAddressStrict(raw) {
  const parsed = parseMailbox(raw);
  if (!parsed) return null;
  return parsed.email;
}

function parseSearchTerm(raw) {
  const value = normalizeLowerTrim(raw);
  return value || null;
}

/**
 * GET /admin/handles
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function listAdminHandles(req, res) {
  try {
    const paging = parsePagination(req);
    if (!paging.ok) return res.status(400).json(paging.error);

    const activeParsed = parseOptionalBoolAsInt(req.query?.active);
    if (!activeParsed.ok) return res.status(400).json({ error: "invalid_params", field: "active" });

    const filters = { active: activeParsed.value };

    if (req.query?.handle !== undefined) {
      const handle = parseSearchTerm(req.query?.handle);
      if (!handle) return res.status(400).json({ error: "invalid_params", field: "handle" });
      filters.handle = handle;
    }

    if (req.query?.address !== undefined) {
      const address = parseSearchTerm(req.query?.address);
      if (!address) return res.status(400).json({ error: "invalid_params", field: "address" });
      filters.address = address;
    }

    const [items, total] = await Promise.all([
      aliasHandlesRepository.listAll({
        limit: paging.limit,
        offset: paging.offset,
        ...filters,
      }),
      aliasHandlesRepository.countAll(filters),
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
    logError("admin.handles.list.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * GET /admin/handles/:id
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function getAdminHandle(req, res) {
  try {
    const id = parseId(req.params?.id);
    if (!id) return res.status(400).json({ error: "invalid_params", field: "id" });

    const row = await aliasHandlesRepository.getById(id);
    if (!row) return res.status(404).json({ error: "handle_not_found", id });

    return res.status(200).json({ item: row });
  } catch (err) {
    logError("admin.handles.get.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * POST /admin/handles
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function createAdminHandle(req, res) {
  try {
    const handle = parseHandleStrict(req.body?.handle);
    if (!handle) return res.status(400).json({ error: "invalid_params", field: "handle" });

    const address = parseAddressStrict(req.body?.address);
    if (!address) return res.status(400).json({ error: "invalid_params", field: "address" });

    const activeParsed = parseOptionalBoolAsInt(req.body?.active);
    if (!activeParsed.ok) return res.status(400).json({ error: "invalid_params", field: "active" });
    const active = activeParsed.value === undefined ? 1 : activeParsed.value;

    const banName = await findActiveNameBan(handle);
    if (banName) return res.status(403).json({ error: "banned", ban: banName });

    const banAddress = await findActiveEmailOrDomainBan(address);
    if (banAddress) return res.status(403).json({ error: "banned", ban: banAddress });

    const existing = await aliasHandlesRepository.getByHandle(handle);
    if (existing) return res.status(409).json({ error: "handle_taken", handle });

    const created = await aliasHandlesRepository.createHandle({ handle, address, active });
    const row = await aliasHandlesRepository.getById(created.insertId);

    return res.status(201).json({
      ok: true,
      created: true,
      item: row,
    });
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "handle_taken" });
    }
    logError("admin.handles.create.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * PATCH /admin/handles/:id
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function updateAdminHandle(req, res) {
  try {
    const id = parseId(req.params?.id);
    if (!id) return res.status(400).json({ error: "invalid_params", field: "id" });

    const current = await aliasHandlesRepository.getById(id);
    if (!current) return res.status(404).json({ error: "handle_not_found", id });

    const patch = {};
    let nextHandle = String(current.handle || "").trim().toLowerCase();
    let nextAddress = String(current.address || "").trim().toLowerCase();
    let handleChanged = false;
    let addressChanged = false;

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "handle")) {
      const handle = parseHandleStrict(req.body?.handle);
      if (!handle) return res.status(400).json({ error: "invalid_params", field: "handle" });

      const conflict = await aliasHandlesRepository.getByHandle(handle);
      if (conflict && Number(conflict.id) !== id) {
        return res.status(409).json({ error: "handle_taken", handle });
      }

      patch.handle = handle;
      nextHandle = handle;
      handleChanged = true;
    }

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "address")) {
      const address = parseAddressStrict(req.body?.address);
      if (!address) return res.status(400).json({ error: "invalid_params", field: "address" });
      patch.address = address;
      nextAddress = address;
      addressChanged = true;
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

    if (handleChanged || addressChanged || nextActive === 1) {
      const banName = await findActiveNameBan(nextHandle);
      if (banName) return res.status(403).json({ error: "banned", ban: banName });

      const banAddress = await findActiveEmailOrDomainBan(nextAddress);
      if (banAddress) return res.status(403).json({ error: "banned", ban: banAddress });
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "invalid_params", reason: "empty_patch" });
    }

    await aliasHandlesRepository.updateById(id, patch);
    const row = await aliasHandlesRepository.getById(id);

    return res.status(200).json({ ok: true, updated: true, item: row });
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "handle_taken" });
    }
    logError("admin.handles.update.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * DELETE /admin/handles/:id
 * Soft delete: active=0.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function deleteAdminHandle(req, res) {
  try {
    const id = parseId(req.params?.id);
    if (!id) return res.status(400).json({ error: "invalid_params", field: "id" });

    const current = await aliasHandlesRepository.getById(id);
    if (!current) return res.status(404).json({ error: "handle_not_found", id });

    const disabled = await aliasHandlesRepository.disableById(id);
    const row = await aliasHandlesRepository.getById(id);

    return res.status(200).json({
      ok: true,
      deleted: Boolean(disabled),
      item: row,
    });
  } catch (err) {
    logError("admin.handles.delete.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

module.exports = {
  listAdminHandles,
  getAdminHandle,
  createAdminHandle,
  updateAdminHandle,
  deleteAdminHandle,
};
