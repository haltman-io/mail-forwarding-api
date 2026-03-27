import net from "node:net";

export const INVALID_TARGET_ERROR = "target must be a domain name without scheme";

const ALLOWED = /^[a-z0-9.-]+$/;
const LABEL = /^[a-z0-9-]+$/;
const MAX_DOMAIN_LENGTH = 253;
const MAX_LABEL_LENGTH = 63;

export function normalizeDomainTarget(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: INVALID_TARGET_ERROR };
  }

  let value = raw.trim().toLowerCase();
  if (!value) {
    return { ok: false, error: INVALID_TARGET_ERROR };
  }

  value = value.replace(/\.+$/, "");
  if (!value) {
    return { ok: false, error: INVALID_TARGET_ERROR };
  }

  if (value.length > MAX_DOMAIN_LENGTH) {
    return { ok: false, error: INVALID_TARGET_ERROR };
  }

  if (!ALLOWED.test(value) || value.includes("..") || net.isIP(value)) {
    return { ok: false, error: INVALID_TARGET_ERROR };
  }

  for (const label of value.split(".")) {
    if (!label || label.length > MAX_LABEL_LENGTH || !LABEL.test(label)) {
      return { ok: false, error: INVALID_TARGET_ERROR };
    }
    if (label.startsWith("-") || label.endsWith("-")) {
      return { ok: false, error: INVALID_TARGET_ERROR };
    }
  }

  return { ok: true, value };
}
