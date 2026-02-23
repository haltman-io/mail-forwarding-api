"use strict";

/**
 * @fileoverview Admin CRUD controller for bans (api_bans).
 */

const net = require("net");
const { bansRepository } = require("../../repositories/bans-repository");
const { logError } = require("../../lib/logger");
const {
  normalizeLowerTrim,
  isValidLocalPart,
  isValidDomain,
  parseMailbox,
} = require("../../lib/mailbox-validation");
const {
  parseId,
  parsePagination,
  parseOptionalBoolAsInt,
  parseOptionalDate,
} = require("./helpers");

const ALLOWED_BAN_TYPES = new Set(["email", "domain", "ip", "name"]);

function normStr(value) {
  return normalizeLowerTrim(value);
}

function normalizeBanType(raw) {
  const value = normStr(raw);
  if (!value || !ALLOWED_BAN_TYPES.has(value)) return null;
  return value;
}

function normalizeBanValue(type, raw) {
  if (type === "email") {
    const parsed = parseMailbox(raw);
    return parsed ? parsed.email : null;
  }
  if (type === "domain") {
    const value = normStr(raw);
    return value && isValidDomain(value) ? value : null;
  }
  if (type === "name") {
    const value = normStr(raw);
    return value && isValidLocalPart(value) ? value : null;
  }
  if (type === "ip") {
    const value = String(raw || "").trim();
    return net.isIP(value) ? value : null;
  }
  return null;
}

function normalizeOptionalReason(raw) {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null || raw === "") return { ok: true, value: null };

  const value = String(raw).trim();
  if (!value) return { ok: true, value: null };
  if (value.length > 255) return { ok: false };
  return { ok: true, value };
}

function isBanActive(row) {
  if (!row) return false;
  if (row.revoked_at) return false;
  if (!row.expires_at) return true;
  const expiresAt = new Date(row.expires_at);
  if (Number.isNaN(expiresAt.getTime())) return false;
  return expiresAt.getTime() > Date.now();
}

/**
 * GET /admin/bans
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function listAdminBans(req, res) {
  try {
    const paging = parsePagination(req);
    if (!paging.ok) return res.status(400).json(paging.error);

    const activeParsed = parseOptionalBoolAsInt(req.query?.active);
    if (!activeParsed.ok) return res.status(400).json({ error: "invalid_params", field: "active" });

    const banTypeRaw = req.query?.ban_type;
    const banValueRaw = req.query?.ban_value;

    const filters = { active: activeParsed.value };

    if (banTypeRaw !== undefined) {
      const banType = normalizeBanType(banTypeRaw);
      if (!banType) return res.status(400).json({ error: "invalid_params", field: "ban_type" });
      filters.banType = banType;
    }

    if (banValueRaw !== undefined) {
      const value = String(banValueRaw || "").trim();
      if (!value) return res.status(400).json({ error: "invalid_params", field: "ban_value" });
      filters.banValue = value;
    }

    const [rows, total] = await Promise.all([
      bansRepository.listAll({
        limit: paging.limit,
        offset: paging.offset,
        ...filters,
      }),
      bansRepository.countAll(filters),
    ]);

    const items = rows.map((row) => ({
      ...row,
      active: isBanActive(row),
    }));

    return res.status(200).json({
      items,
      pagination: {
        total,
        limit: paging.limit,
        offset: paging.offset,
      },
    });
  } catch (err) {
    logError("admin.bans.list.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * GET /admin/bans/:id
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function getAdminBan(req, res) {
  try {
    const id = parseId(req.params?.id);
    if (!id) return res.status(400).json({ error: "invalid_params", field: "id" });

    const row = await bansRepository.getById(id);
    if (!row) return res.status(404).json({ error: "ban_not_found", id });

    return res.status(200).json({
      item: {
        ...row,
        active: isBanActive(row),
      },
    });
  } catch (err) {
    logError("admin.bans.get.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * POST /admin/bans
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function createAdminBan(req, res) {
  try {
    const banType = normalizeBanType(req.body?.ban_type);
    if (!banType) return res.status(400).json({ error: "invalid_params", field: "ban_type" });

    const banValue = normalizeBanValue(banType, req.body?.ban_value);
    if (!banValue) return res.status(400).json({ error: "invalid_params", field: "ban_value" });

    const reasonParsed = normalizeOptionalReason(req.body?.reason);
    if (!reasonParsed.ok) return res.status(400).json({ error: "invalid_params", field: "reason" });

    const expiresAtParsed = parseOptionalDate(req.body?.expires_at);
    if (!expiresAtParsed.ok) {
      return res.status(400).json({ error: "invalid_params", field: "expires_at" });
    }

    const created = await bansRepository.createBan({
      banType,
      banValue,
      reason: reasonParsed.value,
      expiresAt: expiresAtParsed.value,
    });

    const row = await bansRepository.getById(created.insertId);

    return res.status(201).json({
      ok: true,
      created: true,
      item: {
        ...row,
        active: isBanActive(row),
      },
    });
  } catch (err) {
    logError("admin.bans.create.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * PATCH /admin/bans/:id
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function updateAdminBan(req, res) {
  try {
    const id = parseId(req.params?.id);
    if (!id) return res.status(400).json({ error: "invalid_params", field: "id" });

    const current = await bansRepository.getById(id);
    if (!current) return res.status(404).json({ error: "ban_not_found", id });

    const patch = {};

    const bodyHasType = req.body && Object.prototype.hasOwnProperty.call(req.body, "ban_type");
    const bodyHasValue = req.body && Object.prototype.hasOwnProperty.call(req.body, "ban_value");

    const nextType = bodyHasType ? normalizeBanType(req.body?.ban_type) : String(current.ban_type || "");
    if (!nextType) return res.status(400).json({ error: "invalid_params", field: "ban_type" });

    const nextValueRaw = bodyHasValue ? req.body?.ban_value : current.ban_value;
    const nextValue = normalizeBanValue(nextType, nextValueRaw);
    if (!nextValue) return res.status(400).json({ error: "invalid_params", field: "ban_value" });

    if (bodyHasType) patch.banType = nextType;
    if (bodyHasValue) patch.banValue = nextValue;

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "reason")) {
      const reasonParsed = normalizeOptionalReason(req.body?.reason);
      if (!reasonParsed.ok) return res.status(400).json({ error: "invalid_params", field: "reason" });
      patch.reason = reasonParsed.value;
    }

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "expires_at")) {
      const expiresAtParsed = parseOptionalDate(req.body?.expires_at);
      if (!expiresAtParsed.ok) {
        return res.status(400).json({ error: "invalid_params", field: "expires_at" });
      }
      patch.expiresAt = expiresAtParsed.value;
    }

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "revoked")) {
      const revokedParsed = parseOptionalBoolAsInt(req.body?.revoked);
      if (!revokedParsed.ok || revokedParsed.value === undefined) {
        return res.status(400).json({ error: "invalid_params", field: "revoked" });
      }
      patch.revokedAt = revokedParsed.value === 1 ? new Date() : null;
      if (revokedParsed.value === 0 && !Object.prototype.hasOwnProperty.call(req.body, "revoked_reason")) {
        patch.revokedReason = null;
      }
    }

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "revoked_reason")) {
      const revokedReasonParsed = normalizeOptionalReason(req.body?.revoked_reason);
      if (!revokedReasonParsed.ok) {
        return res.status(400).json({ error: "invalid_params", field: "revoked_reason" });
      }
      patch.revokedReason = revokedReasonParsed.value;
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "invalid_params", reason: "empty_patch" });
    }

    await bansRepository.updateById(id, patch);
    const row = await bansRepository.getById(id);

    return res.status(200).json({
      ok: true,
      updated: true,
      item: {
        ...row,
        active: isBanActive(row),
      },
    });
  } catch (err) {
    logError("admin.bans.update.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * DELETE /admin/bans/:id
 * Semantic delete: revoke ban.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function deleteAdminBan(req, res) {
  try {
    const id = parseId(req.params?.id);
    if (!id) return res.status(400).json({ error: "invalid_params", field: "id" });

    const current = await bansRepository.getById(id);
    if (!current) return res.status(404).json({ error: "ban_not_found", id });

    const revokedReasonParsed = normalizeOptionalReason(req.body?.revoked_reason);
    if (!revokedReasonParsed.ok) {
      return res.status(400).json({ error: "invalid_params", field: "revoked_reason" });
    }

    const revoked = await bansRepository.revokeById(id, revokedReasonParsed.value ?? null);
    const row = await bansRepository.getById(id);

    return res.status(200).json({
      ok: true,
      deleted: Boolean(revoked),
      item: {
        ...row,
        active: isBanActive(row),
      },
    });
  } catch (err) {
    logError("admin.bans.delete.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

module.exports = {
  listAdminBans,
  getAdminBan,
  createAdminBan,
  updateAdminBan,
  deleteAdminBan,
};
