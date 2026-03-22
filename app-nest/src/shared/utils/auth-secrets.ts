import crypto from "node:crypto";

export const DEFAULT_OPAQUE_TOKEN_BYTES = 32;

const RE_OPAQUE_TOKEN = /^[A-Za-z0-9_-]{32,512}$/;

export function createOpaqueToken(bytes = DEFAULT_OPAQUE_TOKEN_BYTES): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function normalizeOpaqueToken(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

export function isOpaqueTokenFormatValid(value: unknown): boolean {
  return RE_OPAQUE_TOKEN.test(normalizeOpaqueToken(value));
}
