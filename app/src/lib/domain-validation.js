"use strict";

/**
 * @fileoverview Domain normalization and validation helpers.
 */

const net = require("net");

const INVALID_TARGET_ERROR = "target must be a domain name without scheme";
const RE_ALLOWED = /^[a-z0-9.-]+$/;
const RE_LABEL = /^[a-z0-9-]+$/;
const MAX_DOMAIN_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;

/**
 * Normalize a domain-like target string.
 * @param {unknown} raw
 * @returns {{ ok: boolean, value?: string, error?: string }}
 */
function normalizeDomainTarget(raw) {
  if (typeof raw !== "string") return { ok: false, error: INVALID_TARGET_ERROR };

  let value = raw.trim().toLowerCase();
  if (!value) return { ok: false, error: INVALID_TARGET_ERROR };

  value = value.replace(/\.+$/, "");
  if (!value) return { ok: false, error: INVALID_TARGET_ERROR };

  if (value.length > MAX_DOMAIN_LENGTH) return { ok: false, error: INVALID_TARGET_ERROR };
  if (!RE_ALLOWED.test(value)) return { ok: false, error: INVALID_TARGET_ERROR };
  if (value.includes("..")) return { ok: false, error: INVALID_TARGET_ERROR };
  if (net.isIP(value)) return { ok: false, error: INVALID_TARGET_ERROR };

  const labels = value.split(".");
  for (const label of labels) {
    if (!label || label.length > MAX_LABEL_LENGTH) {
      return { ok: false, error: INVALID_TARGET_ERROR };
    }
    if (!RE_LABEL.test(label)) {
      return { ok: false, error: INVALID_TARGET_ERROR };
    }
    if (label.startsWith("-") || label.endsWith("-")) {
      return { ok: false, error: INVALID_TARGET_ERROR };
    }
  }

  return { ok: true, value };
}

module.exports = { normalizeDomainTarget, INVALID_TARGET_ERROR };
