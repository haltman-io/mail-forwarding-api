import crypto from "node:crypto";
import type { Request } from "express";

export function deriveCsrfToken(sessionFamilyId: string, secret: string): string {
  return crypto
    .createHmac("sha256", String(secret || "").trim())
    .update(String(sessionFamilyId || ""), "utf8")
    .digest("base64url");
}

export function readCsrfHeader(req: Request): string {
  return String(req.header("X-CSRF-Token") || "").trim();
}

export function isCsrfTokenValid(
  sessionFamilyId: string,
  providedToken: string,
  secret: string,
): boolean {
  const expected = deriveCsrfToken(sessionFamilyId, secret);
  const actual = String(providedToken || "").trim();
  if (!expected || !actual) return false;

  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(actual, "utf8");
  if (expectedBuf.length !== actualBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}
