"use strict";

/**
 * @fileoverview Mailbox validation helpers for alias workflows.
 *
 * Local-part follows RFC 5322 dot-atom syntax (quoted-string is intentionally
 * not supported), with lower-case normalization for API consistency.
 *
 * Domain follows strict DNS label constraints aligned with RFC 1035 usage:
 * labels 1..63 chars, total length <=253, letters/digits/hyphen, no leading
 * or trailing hyphen.
 */

const MAX_EMAIL_LENGTH = 254;
const MAX_LOCAL_PART_LENGTH = 64;

const RE_LOCAL_DOT_ATOM =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const RE_DOMAIN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function normalizeLowerTrim(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function isValidLocalPart(localPart) {
  const value = normalizeLowerTrim(localPart);
  if (!value || value.length > MAX_LOCAL_PART_LENGTH) return false;
  return RE_LOCAL_DOT_ATOM.test(value);
}

function isValidDomain(domain) {
  const value = normalizeLowerTrim(domain);
  return RE_DOMAIN.test(value);
}

function parseMailbox(raw) {
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

module.exports = {
  MAX_EMAIL_LENGTH,
  MAX_LOCAL_PART_LENGTH,
  normalizeLowerTrim,
  isValidLocalPart,
  isValidDomain,
  parseMailbox,
};

