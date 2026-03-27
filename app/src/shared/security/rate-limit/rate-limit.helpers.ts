import type { Request } from "express";

const API_KEY_RE = /^[a-z0-9]{64}$/;

function normalizeString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function normalizeEmail(value: unknown): string {
  return normalizeString(value);
}

function normalizeBodyEmail(req: Request, field = "email"): string {
  const body = req.body as Record<string, unknown> | undefined;
  const query = req.query as Record<string, unknown> | undefined;
  return normalizeEmail(body?.[field] ?? query?.[field] ?? "");
}

export function normalizeGetTo(req: Request): string {
  const query = req.query as Record<string, unknown> | undefined;
  return normalizeEmail(query?.to);
}

export function normalizeGetDomain(req: Request): string {
  const query = req.query as Record<string, unknown> | undefined;
  return normalizeString(query?.domain ?? "");
}

export function normalizeGetName(req: Request): string {
  const query = req.query as Record<string, unknown> | undefined;
  return normalizeString(query?.name ?? "");
}

export function normalizeGetAddress(req: Request): string {
  const query = req.query as Record<string, unknown> | undefined;
  return normalizeEmail(query?.address);
}

export function normalizeGetToken(req: Request): string {
  const query = req.query as Record<string, unknown> | undefined;
  const params = req.params as Record<string, unknown> | undefined;
  return normalizeString(query?.token ?? params?.token ?? "");
}

export function normalizeBodyTarget(req: Request): string {
  const body = req.body as Record<string, unknown> | undefined;
  return normalizeString(body?.target ?? "");
}

export function normalizeRouteTarget(req: Request): string {
  const params = req.params as Record<string, unknown> | undefined;
  const fromParams = normalizeString(params?.target ?? "");
  if (fromParams) {
    return fromParams;
  }

  const segments = String(req.path || "")
    .split("/")
    .filter(Boolean);
  return normalizeString(segments[segments.length - 1] ?? "");
}

export function normalizeApiKey(req: Request): string {
  const headerValue = String(req.header("x-api-key") || "").trim().toLowerCase();
  return API_KEY_RE.test(headerValue) ? headerValue : "";
}

export function keyByIp(req: Request): string {
  return String(req.ip || "").trim().toLowerCase() || "missing_ip";
}

export function normalizeCredentialEmail(req: Request): string {
  return normalizeBodyEmail(req, "email");
}

export function normalizeAuthEmail(req: Request): string {
  return normalizeBodyEmail(req, "email");
}

export function normalizeAuthIdentifier(req: Request): string {
  const body = req.body as Record<string, unknown> | undefined;
  const query = req.query as Record<string, unknown> | undefined;
  return normalizeString(body?.identifier ?? query?.identifier ?? "");
}

export function normalizeBodyToken(req: Request): string {
  const body = req.body as Record<string, unknown> | undefined;
  return normalizeString(body?.token ?? "");
}
