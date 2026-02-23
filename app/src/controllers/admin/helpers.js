"use strict";

/**
 * @fileoverview Shared helpers for admin controllers.
 */

function parseId(raw) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
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

function parseOptionalBoolAsInt(raw) {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null) return { ok: false };
  if (typeof raw === "boolean") return { ok: true, value: raw ? 1 : 0 };
  if (typeof raw === "number") {
    if (raw === 1) return { ok: true, value: 1 };
    if (raw === 0) return { ok: true, value: 0 };
    return { ok: false };
  }

  const value = String(raw).trim().toLowerCase();
  if (!value) return { ok: false };

  if (["1", "true", "yes", "on"].includes(value)) return { ok: true, value: 1 };
  if (["0", "false", "no", "off"].includes(value)) return { ok: true, value: 0 };

  return { ok: false };
}

function parseOptionalDate(raw) {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null || raw === "") return { ok: true, value: null };

  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return { ok: false };
  return { ok: true, value: dt };
}

module.exports = {
  parseId,
  parsePagination,
  parseOptionalBoolAsInt,
  parseOptionalDate,
};
