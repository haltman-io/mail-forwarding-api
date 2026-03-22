import type { CookieOptions, Request, Response } from "express";

export const ACCESS_COOKIE_NAME = "__Host-access";
export const REFRESH_COOKIE_NAME = "__Host-refresh";

export type AuthCookieSameSite = "lax" | "strict" | "none";

function parseCookiesHeader(headerValue: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = String(headerValue || "");
  if (!raw) return out;

  for (const chunk of raw.split(";")) {
    const index = chunk.indexOf("=");
    if (index <= 0) continue;
    const key = chunk.slice(0, index).trim();
    const value = chunk.slice(index + 1).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(value);
  }

  return out;
}

export function shouldUseSecureCookies(envName: string): boolean {
  return String(envName || "").trim().toLowerCase() === "prod";
}

export function normalizeSameSite(value: unknown): AuthCookieSameSite {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "strict") return "strict";
  if (normalized === "none") return "none";
  return "lax";
}

export function buildCookieOptions(payload: {
  maxAgeMs: number;
  envName: string;
  sameSite?: AuthCookieSameSite;
}): CookieOptions {
  return {
    httpOnly: true,
    secure: shouldUseSecureCookies(payload.envName),
    sameSite: normalizeSameSite(payload.sameSite || "lax"),
    path: "/",
    maxAge: payload.maxAgeMs,
  };
}

export function readCookie(req: Request, name: string): string {
  const cookies = parseCookiesHeader(req.headers.cookie);
  return String(cookies[name] || "").trim();
}

export function getAccessCookie(req: Request): string {
  return readCookie(req, ACCESS_COOKIE_NAME);
}

export function getRefreshCookie(req: Request): string {
  return readCookie(req, REFRESH_COOKIE_NAME);
}

export function setAccessCookie(
  res: Response,
  token: string,
  options: CookieOptions,
): void {
  res.cookie(ACCESS_COOKIE_NAME, token, options);
}

export function setRefreshCookie(
  res: Response,
  token: string,
  options: CookieOptions,
): void {
  res.cookie(REFRESH_COOKIE_NAME, token, options);
}

export function clearAuthCookies(
  res: Response,
  envName: string,
  sameSite: AuthCookieSameSite = "lax",
): void {
  const cookieOptions = buildCookieOptions({ maxAgeMs: 0, envName, sameSite });

  res.clearCookie(ACCESS_COOKIE_NAME, cookieOptions);
  res.clearCookie(REFRESH_COOKIE_NAME, cookieOptions);
}
