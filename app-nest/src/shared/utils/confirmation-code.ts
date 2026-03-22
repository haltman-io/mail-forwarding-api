import crypto from "node:crypto";

const CONFIRMATION_CODE_LENGTH = 6;
const RE_CONFIRMATION_CODE = /^\d{6}$/;

export function generateConfirmationCode(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(CONFIRMATION_CODE_LENGTH, "0");
}

export function normalizeConfirmationCode(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

export function isConfirmationCodeValid(code: string): boolean {
  return RE_CONFIRMATION_CODE.test(String(code || ""));
}
