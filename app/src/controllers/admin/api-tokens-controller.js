"use strict";

/**
 * @fileoverview Admin CRUD controller for api_tokens.
 */

const crypto = require("crypto");
const { apiTokensRepository } = require("../../repositories/api-tokens-repository");
const { parseMailbox } = require("../../lib/mailbox-validation");
const { packIp16 } = require("../../lib/ip-pack");
const { logError } = require("../../lib/logger");
const {
  parseId,
  parsePagination,
  parseOptionalBoolAsInt,
  parseOptionalDate,
} = require("./helpers");

const ALLOWED_TOKEN_STATUS = new Set(["active", "revoked", "expired"]);

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest();
}

function normalizeStatus(raw) {
  const value = String(raw || "").trim().toLowerCase();
  if (!value || !ALLOWED_TOKEN_STATUS.has(value)) return null;
  return value;
}

function parseDays(raw) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 90) return null;
  return value;
}

function normalizeOptionalReason(raw) {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null || raw === "") return { ok: true, value: null };

  const value = String(raw).trim();
  if (!value) return { ok: true, value: null };
  if (value.length > 255) return { ok: false };
  return { ok: true, value };
}

function isTokenActive(row) {
  if (!row) return false;
  if (String(row.status || "") !== "active") return false;
  if (row.revoked_at) return false;
  const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) return false;
  return expiresAt.getTime() > Date.now();
}

/**
 * GET /admin/api-tokens
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function listAdminApiTokens(req, res) {
  try {
    const paging = parsePagination(req);
    if (!paging.ok) return res.status(400).json(paging.error);

    const activeParsed = parseOptionalBoolAsInt(req.query?.active);
    if (!activeParsed.ok) return res.status(400).json({ error: "invalid_params", field: "active" });

    const filters = { active: activeParsed.value };

    if (req.query?.owner_email !== undefined) {
      const email = parseMailbox(req.query?.owner_email);
      if (!email) return res.status(400).json({ error: "invalid_params", field: "owner_email" });
      filters.ownerEmail = email.email;
    }

    if (req.query?.status !== undefined) {
      const status = normalizeStatus(req.query?.status);
      if (!status) return res.status(400).json({ error: "invalid_params", field: "status" });
      filters.status = status;
    }

    const [rows, total] = await Promise.all([
      apiTokensRepository.listAll({
        limit: paging.limit,
        offset: paging.offset,
        ...filters,
      }),
      apiTokensRepository.countAll(filters),
    ]);

    const items = rows.map((row) => ({
      ...row,
      active: isTokenActive(row),
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
    logError("admin.apiTokens.list.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * GET /admin/api-tokens/:id
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function getAdminApiToken(req, res) {
  try {
    const id = parseId(req.params?.id);
    if (!id) return res.status(400).json({ error: "invalid_params", field: "id" });

    const row = await apiTokensRepository.getById(id);
    if (!row) return res.status(404).json({ error: "api_token_not_found", id });

    return res.status(200).json({
      item: {
        ...row,
        active: isTokenActive(row),
      },
    });
  } catch (err) {
    logError("admin.apiTokens.get.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * POST /admin/api-tokens
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function createAdminApiToken(req, res) {
  try {
    const ownerEmailParsed = parseMailbox(req.body?.owner_email);
    if (!ownerEmailParsed) {
      return res.status(400).json({ error: "invalid_params", field: "owner_email" });
    }

    const daysRaw = req.body?.days === undefined ? 30 : req.body?.days;
    const days = parseDays(daysRaw);
    if (!days) {
      return res.status(400).json({ error: "invalid_params", field: "days", hint: "integer 1..90" });
    }

    const tokenPlain = crypto.randomBytes(32).toString("hex");
    const tokenHash32 = sha256Buffer(tokenPlain);

    const userAgentInput = req.body?.user_agent;
    const userAgent =
      userAgentInput !== undefined
        ? String(userAgentInput || "").slice(0, 255)
        : String(req.headers["user-agent"] || "").slice(0, 255);

    const created = await apiTokensRepository.createToken({
      ownerEmail: ownerEmailParsed.email,
      tokenHash32,
      days,
      createdIpPacked: packIp16(req.ip),
      userAgentOrNull: userAgent || null,
    });

    const row = await apiTokensRepository.getById(created.insertId);

    return res.status(201).json({
      ok: true,
      created: true,
      token: tokenPlain,
      token_type: "api_key",
      item: {
        ...row,
        active: isTokenActive(row),
      },
    });
  } catch (err) {
    logError("admin.apiTokens.create.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * PATCH /admin/api-tokens/:id
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function updateAdminApiToken(req, res) {
  try {
    const id = parseId(req.params?.id);
    if (!id) return res.status(400).json({ error: "invalid_params", field: "id" });

    const current = await apiTokensRepository.getById(id);
    if (!current) return res.status(404).json({ error: "api_token_not_found", id });

    const patch = {};

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "owner_email")) {
      const ownerEmailParsed = parseMailbox(req.body?.owner_email);
      if (!ownerEmailParsed) {
        return res.status(400).json({ error: "invalid_params", field: "owner_email" });
      }
      patch.ownerEmail = ownerEmailParsed.email;
    }

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "status")) {
      const status = normalizeStatus(req.body?.status);
      if (!status) return res.status(400).json({ error: "invalid_params", field: "status" });
      patch.status = status;
    }

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "expires_at")) {
      const expiresAtParsed = parseOptionalDate(req.body?.expires_at);
      if (!expiresAtParsed.ok || expiresAtParsed.value === null || expiresAtParsed.value === undefined) {
        return res.status(400).json({ error: "invalid_params", field: "expires_at" });
      }
      patch.expiresAt = expiresAtParsed.value;
    }

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "revoked")) {
      const revokedParsed = parseOptionalBoolAsInt(req.body?.revoked);
      if (!revokedParsed.ok || revokedParsed.value === undefined) {
        return res.status(400).json({ error: "invalid_params", field: "revoked" });
      }

      if (patch.status && ((revokedParsed.value === 1 && patch.status !== "revoked") || (revokedParsed.value === 0 && patch.status === "revoked"))) {
        return res.status(400).json({ error: "invalid_params", reason: "status_revoked_conflict" });
      }

      patch.status = revokedParsed.value === 1 ? "revoked" : "active";
      patch.revokedAt = revokedParsed.value === 1 ? new Date() : null;
      if (revokedParsed.value === 0 && !Object.prototype.hasOwnProperty.call(req.body, "revoked_reason")) {
        patch.revokedReason = null;
      }
    }

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, "revoked_reason")) {
      const reasonParsed = normalizeOptionalReason(req.body?.revoked_reason);
      if (!reasonParsed.ok) {
        return res.status(400).json({ error: "invalid_params", field: "revoked_reason" });
      }
      patch.revokedReason = reasonParsed.value;
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: "invalid_params", reason: "empty_patch" });
    }

    await apiTokensRepository.updateById(id, patch);
    const row = await apiTokensRepository.getById(id);

    return res.status(200).json({
      ok: true,
      updated: true,
      item: {
        ...row,
        active: isTokenActive(row),
      },
    });
  } catch (err) {
    logError("admin.apiTokens.update.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * DELETE /admin/api-tokens/:id
 * Semantic delete: revoke token.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function deleteAdminApiToken(req, res) {
  try {
    const id = parseId(req.params?.id);
    if (!id) return res.status(400).json({ error: "invalid_params", field: "id" });

    const current = await apiTokensRepository.getById(id);
    if (!current) return res.status(404).json({ error: "api_token_not_found", id });

    const reasonParsed = normalizeOptionalReason(req.body?.revoked_reason);
    if (!reasonParsed.ok) {
      return res.status(400).json({ error: "invalid_params", field: "revoked_reason" });
    }

    const revoked = await apiTokensRepository.revokeById(id, reasonParsed.value ?? null);
    const row = await apiTokensRepository.getById(id);

    return res.status(200).json({
      ok: true,
      deleted: Boolean(revoked),
      item: {
        ...row,
        active: isTokenActive(row),
      },
    });
  } catch (err) {
    logError("admin.apiTokens.delete.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

module.exports = {
  listAdminApiTokens,
  getAdminApiToken,
  createAdminApiToken,
  updateAdminApiToken,
  deleteAdminApiToken,
};
