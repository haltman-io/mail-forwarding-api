"use strict";

/**
 * @fileoverview Shared helpers to enforce api_bans policy consistently.
 */

const net = require("net");
const { bansRepository } = require("../repositories/bans-repository");
const { normalizeLowerTrim, parseMailbox } = require("./mailbox-validation");

function normalizeString(value) {
  return normalizeLowerTrim(value);
}

function uniqueNonEmpty(values) {
  const out = [];
  const seen = new Set();

  for (const value of values || []) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

/**
 * Domain + parent suffixes (without TLD-only suffix).
 * Example: a.b.example.com => [a.b.example.com, b.example.com, example.com]
 * @param {string} domain
 * @returns {string[]}
 */
function domainSuffixes(domain) {
  const normalized = normalizeString(domain);
  if (!normalized) return [];

  const parts = normalized.split(".").filter(Boolean);
  if (parts.length < 2) return [];

  const out = [];
  for (let i = 0; i < parts.length - 1; i++) {
    out.push(parts.slice(i).join("."));
  }
  return uniqueNonEmpty(out);
}

/**
 * IP candidate forms to match bans regardless of IPv4/IPv6-mapped notation.
 * @param {string} ip
 * @returns {string[]}
 */
function ipCandidates(ip) {
  const raw = String(ip || "").trim().toLowerCase();
  if (!raw) return [];

  const out = new Set();

  if (net.isIP(raw) === 4) {
    out.add(raw);
    out.add(`::ffff:${raw}`);
    return Array.from(out);
  }

  if (net.isIP(raw) === 6) {
    out.add(raw);
    const mapped = raw.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
    if (mapped && net.isIP(mapped[1]) === 4) out.add(mapped[1]);
    return Array.from(out);
  }

  return [];
}

/**
 * @param {string} ip
 * @returns {Promise<object | null>}
 */
async function findActiveIpBan(ip) {
  const candidates = ipCandidates(ip);
  if (candidates.length === 0) return null;
  return bansRepository.getActiveBanByValues("ip", candidates);
}

/**
 * @param {string} domain
 * @returns {Promise<object | null>}
 */
async function findActiveDomainBan(domain) {
  const suffixes = domainSuffixes(domain);
  if (suffixes.length === 0) return null;
  return bansRepository.getActiveBanByValues("domain", suffixes);
}

/**
 * @param {string} email
 * @returns {Promise<object | null>}
 */
async function findActiveEmailOrDomainBan(email) {
  const parsed = parseMailbox(email);
  if (!parsed) return null;

  const byEmail = await bansRepository.getBannedEmail(parsed.email);
  if (byEmail) return byEmail;

  return findActiveDomainBan(parsed.domain);
}

/**
 * @param {string} value
 * @returns {Promise<object | null>}
 */
async function findActiveNameBan(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  return bansRepository.getBannedName(normalized);
}

module.exports = {
  domainSuffixes,
  ipCandidates,
  findActiveIpBan,
  findActiveDomainBan,
  findActiveEmailOrDomainBan,
  findActiveNameBan,
};
