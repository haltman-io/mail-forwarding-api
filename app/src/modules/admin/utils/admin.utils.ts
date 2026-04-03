import format from "string-format";

export interface AdminPublicUser {
  id: number;
  username: string;
  email: string;
  email_verified_at: Date | string | null;
  is_active: number;
  is_admin: boolean;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  last_login_at: Date | string | null;
}

export function buildContainsLikePattern(raw: unknown): string | null {
  const normalized = String(raw || "").trim().toLowerCase();
  if (!normalized) return null;
  const escaped = normalized.replace(/[\\%_]/g, "\\$&");
  return `%${escaped}%`;
}

export function toAdminPublicUser(row: {
  id: number;
  username: string;
  email: string;
  email_verified_at: Date | string | null;
  is_active: number;
  is_admin: number;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  last_login_at: Date | string | null;
} | null): AdminPublicUser | null {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    email_verified_at: row.email_verified_at || null,
    is_active: Number(row.is_active || 0),
    is_admin: Number(row.is_admin || 0) === 1,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    last_login_at: row.last_login_at || null,
  };
}

export function isBanActive(row: {
  revoked_at: Date | string | null;
  expires_at: Date | string | null;
} | null): boolean {
  if (!row) return false;
  if (row.revoked_at) return false;
  if (!row.expires_at) return true;
  const expiresAt = new Date(row.expires_at);
  if (Number.isNaN(expiresAt.getTime())) return false;
  return expiresAt.getTime() > Date.now();
}

export function isApiTokenActive(row: {
  status: string;
  revoked_at: Date | string | null;
  expires_at: Date | string | null;
} | null): boolean {
  if (!row) return false;
  if (String(row.status || "") !== "active") return false;
  if (row.revoked_at) return false;
  const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) return false;
  return expiresAt.getTime() > Date.now();
}

export function escapeHtml(value: unknown): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function extractHostFromUrl(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "mail-forwarding-api";

  try {
    return new URL(raw).hostname || "mail-forwarding-api";
  } catch {
    return raw.replace(/^https?:\/\//i, "").replace(/\/.*$/, "") || "mail-forwarding-api";
  }
}

export function formatAdminEmailSubject(input: {
  template: string;
  host: string;
  action?: string;
  targetEmail?: string;
  actorEmail?: string;
  occurredAtIso?: string;
  fallback: string;
}): string {
  const template = String(input.template || "").trim() || input.fallback;

  try {
    return format(template, {
      host: input.host,
      action: input.action || "",
      target_email: input.targetEmail || "",
      actor_email: input.actorEmail || "",
      occurred_at: input.occurredAtIso || "",
    }).trim();
  } catch {
    return format(input.fallback, { host: input.host }).trim();
  }
}
