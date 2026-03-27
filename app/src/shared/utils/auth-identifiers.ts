import { parseMailbox, normalizeLowerTrim } from "../validation/mailbox.js";

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 64;

const RE_USERNAME =
  /^(?=.{3,64}$)[a-z0-9](?:[a-z0-9._-]{1,62}[a-z0-9])?$/;

export interface ParsedIdentifier {
  type: "email" | "username";
  value: string;
}

export function normalizeEmailStrict(raw: unknown): string | null {
  const parsed = parseMailbox(raw);
  if (!parsed) return null;
  if (parsed.email.length > 254) return null;
  return parsed.email;
}

export function normalizeUsername(raw: unknown): string | null {
  const value = normalizeLowerTrim(raw);
  if (!value) return null;
  if (value.includes("@")) return null;
  if (!RE_USERNAME.test(value)) return null;
  return value;
}

export function parseIdentifier(raw: unknown): ParsedIdentifier | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return null;

  if (value.includes("@")) {
    const email = normalizeEmailStrict(value);
    if (!email) return null;
    return { type: "email", value: email };
  }

  const username = normalizeUsername(value);
  if (!username) return null;
  return { type: "username", value: username };
}
