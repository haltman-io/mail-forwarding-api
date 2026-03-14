"use strict";

/**
 * @fileoverview Dynamic CORS origin policy backed by active domains.
 */

const { config } = require("../config");
const { domainRepository } = require("../repositories/domain-repository");
const { normalizeDomainTarget } = require("./domain-validation");

const DOMAINS_CACHE_TTL_MS = 10_000;

let domainsCache = {
  at: 0,
  data: null,
};

function normalizeOrigin(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

    const normalized = normalizeDomainTarget(parsed.hostname);
    if (!normalized.ok || !normalized.value) return null;

    return {
      origin: parsed.origin.replace(/\/+$/, ""),
      domain: normalized.value,
    };
  } catch (_) {
    return null;
  }
}

function buildStaticAllowedOriginSet() {
  const set = new Set();

  for (const raw of Array.isArray(config.corsAllowedOrigins) ? config.corsAllowedOrigins : []) {
    const normalized = normalizeOrigin(raw);
    if (normalized?.origin) set.add(normalized.origin);
  }

  const publicOrigin = normalizeOrigin(config.appPublicUrl);
  if (publicOrigin?.origin) set.add(publicOrigin.origin);

  return set;
}

async function getActiveDomainSetCached() {
  const now = Date.now();
  if (domainsCache.data && now - domainsCache.at < DOMAINS_CACHE_TTL_MS) {
    return domainsCache.data;
  }

  const names = await domainRepository.listActiveNames();
  const set = new Set();

  for (const name of names) {
    const normalized = normalizeDomainTarget(name);
    if (normalized.ok && normalized.value) set.add(normalized.value);
  }

  domainsCache = {
    at: now,
    data: set,
  };

  return set;
}

async function isOriginAllowed(origin) {
  if (!origin) return true;

  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  if (buildStaticAllowedOriginSet().has(normalized.origin)) {
    return true;
  }

  try {
    const activeDomains = await getActiveDomainSetCached();
    return activeDomains.has(normalized.domain);
  } catch (_) {
    return false;
  }
}

function resetCorsOriginPolicyCache() {
  domainsCache = {
    at: 0,
    data: null,
  };
}

module.exports = {
  isOriginAllowed,
  normalizeOrigin,
  resetCorsOriginPolicyCache,
};
