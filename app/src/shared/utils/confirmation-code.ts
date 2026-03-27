import crypto from "node:crypto";

const CODE_LENGTH = 6;
const CODE_MAX = 999_999;
const RE_SIX_DIGITS = /^\d{6}$/;

export function generateConfirmationCode(): string {
  const num = crypto.randomInt(0, CODE_MAX + 1);
  return String(num).padStart(CODE_LENGTH, "0");
}

export function normalizeConfirmationCode(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

export function isConfirmationCodeValid(code: string): boolean {
  return RE_SIX_DIGITS.test(normalizeConfirmationCode(code));
}
