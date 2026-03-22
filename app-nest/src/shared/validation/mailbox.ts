export const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_PART_LENGTH = 64;

const RE_LOCAL_DOT_ATOM =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const RE_DOMAIN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normalizeLowerTrim(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

export function isValidLocalPart(localPart: unknown): boolean {
  const value = normalizeLowerTrim(localPart);
  if (!value || value.length > MAX_LOCAL_PART_LENGTH) return false;
  return RE_LOCAL_DOT_ATOM.test(value);
}

export function isValidDomain(domain: unknown): boolean {
  const value = normalizeLowerTrim(domain);
  return RE_DOMAIN.test(value);
}

export interface ParsedMailbox {
  email: string;
  local: string;
  domain: string;
}

export function parseMailbox(raw: unknown): ParsedMailbox | null {
  const value = normalizeLowerTrim(raw);
  if (!value || value.length > MAX_EMAIL_LENGTH) return null;

  const at = value.indexOf("@");
  if (at <= 0) return null;
  if (value.indexOf("@", at + 1) !== -1) return null;

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);

  if (!isValidLocalPart(local)) return null;
  if (!isValidDomain(domain)) return null;

  return { email: value, local, domain };
}
