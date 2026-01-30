"use strict";

/**
 * @fileoverview Rate limit and slow-down middlewares with Redis store support.
 */

const { config } = require("../config");
const { rateLimitHelpers } = require("./rate-limit-helpers");
const { getRedisClient, isRedisConfigured } = require("../lib/redis-client");
const { logger } = require("../lib/logger");

const { rateLimit: createRateLimit, ipKeyGenerator } = require("express-rate-limit");
const { RedisStore } = require("rate-limit-redis");
const slowDown = require("express-slow-down");

const globalLimit = Number(config.rlGlobalPerMin ?? 300);
const keyByIp = (req) => ipKeyGenerator(req.ip);

/** @type {import('redis').RedisClientType | null} */
let redisClient = null;

/** @type {boolean} */
let redisInitialized = false;

/**
 * Initialize Redis client for rate limiting.
 * Should be called during app startup.
 * @returns {Promise<void>}
 */
async function initializeRedisStore() {
  if (!isRedisConfigured()) {
    logger.warn("ratelimit.redis.notConfigured", {
      message: "REDIS_URL not set, using in-memory store (not recommended for production)",
    });
    return;
  }

  try {
    redisClient = await getRedisClient();
    redisInitialized = true;
    logger.info("ratelimit.redis.initialized");
  } catch (err) {
    logger.error("ratelimit.redis.initFailed", {
      err: err?.message || String(err),
      message: "Falling back to in-memory store",
    });
    redisClient = null;
    redisInitialized = false;
  }
}

/**
 * Create a RedisStore instance if Redis is available.
 * @param {string} prefix - Key prefix for this limiter
 * @returns {import('rate-limit-redis').RedisStore | undefined}
 */
function createRedisStore(prefix) {
  if (!redisClient || !redisInitialized) {
    return undefined;
  }

  return new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
    prefix: `rl:${prefix}:`,
  });
}

/**
 * Factory to create rate limiters with optional Redis store.
 * @param {object} options - Rate limiter options
 * @param {string} storeName - Name for Redis key prefix
 * @returns {import('express-rate-limit').RateLimitRequestHandler}
 */
function createRateLimiter(options, storeName) {
  const store = createRedisStore(storeName);

  return createRateLimit({
    ...options,
    store,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiters (lazily initialized with Redis store when available)
// ─────────────────────────────────────────────────────────────────────────────

const rateLimit = {
  helpers: rateLimitHelpers,

  /**
   * Initialize Redis store for all rate limiters.
   * Call this during app startup before handling requests.
   */
  initialize: initializeRedisStore,

  // ───────────────────────────────────────────────────────────────────────────
  // GLOBAL
  // ───────────────────────────────────────────────────────────────────────────
  get globalLimiter() {
    return createRateLimiter(
      {
        windowMs: 60 * 1000,
        limit: globalLimit,
        skip: () => globalLimit === 0,
        standardHeaders: "draft-7",
        legacyHeaders: false,
      },
      "global"
    );
  },

  // ───────────────────────────────────────────────────────────────────────────
  // /forward/subscribe
  // ───────────────────────────────────────────────────────────────────────────
  subscribeSlowByIp: slowDown({
    windowMs: 60 * 1000,
    delayAfter: Number(config.sdSubscribeDelayAfter ?? 10),
    delayMs: (hits) => {
      const after = Number(config.sdSubscribeDelayAfter ?? 10);
      const step = Number(config.sdSubscribeDelayStepMs ?? 250);
      return Math.max(0, (hits - after) * step);
    },
    keyGenerator: keyByIp,
  }),

  get subscribeLimitByIp() {
    return createRateLimiter(
      {
        windowMs: 10 * 60 * 1000,
        limit: Number(config.rlSubscribePer10MinPerIp ?? 60),
        skip: () => Number(config.rlSubscribePer10MinPerIp ?? 60) === 0,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { error: "rate_limited", where: "subscribe", reason: "too_many_requests_ip" },
        keyGenerator: keyByIp,
      },
      "sub_ip"
    );
  },

  get subscribeLimitByTo() {
    return createRateLimiter(
      {
        windowMs: 60 * 60 * 1000,
        limit: Number(config.rlSubscribePerHourPerTo ?? 6),
        skip: () => Number(config.rlSubscribePerHourPerTo ?? 6) === 0,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { error: "rate_limited", where: "subscribe", reason: "too_many_requests_to" },
        keyGenerator: (req) => {
          const to = rateLimitHelpers.normalizeGetTo(req);
          return `to:${to || "missing"}`;
        },
      },
      "sub_to"
    );
  },

  get subscribeLimitByAlias() {
    return createRateLimiter(
      {
        windowMs: 60 * 60 * 1000,
        limit: Number(config.rlSubscribePerHourPerAlias ?? 20),
        skip: () => Number(config.rlSubscribePerHourPerAlias ?? 20) === 0,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { error: "rate_limited", where: "subscribe", reason: "too_many_requests_alias" },
        keyGenerator: (req) => {
          const name = rateLimitHelpers.normalizeGetName(req);
          const domain = rateLimitHelpers.normalizeGetDomain(req) || "default";
          return `alias:${domain}:${name || "missing"}`;
        },
      },
      "sub_alias"
    );
  },

  // ───────────────────────────────────────────────────────────────────────────
  // /forward/confirm
  // ───────────────────────────────────────────────────────────────────────────
  get confirmLimitByIp() {
    return createRateLimiter(
      {
        windowMs: 10 * 60 * 1000,
        limit: Number(config.rlConfirmPer10MinPerIp ?? 120),
        skip: () => Number(config.rlConfirmPer10MinPerIp ?? 120) === 0,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { error: "rate_limited", where: "confirm", reason: "too_many_requests_ip" },
        keyGenerator: keyByIp,
      },
      "confirm_ip"
    );
  },

  get confirmLimitByToken() {
    return createRateLimiter(
      {
        windowMs: 10 * 60 * 1000,
        limit: Number(config.rlConfirmPer10MinPerToken ?? 10),
        skip: () => Number(config.rlConfirmPer10MinPerToken ?? 10) === 0,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { error: "rate_limited", where: "confirm", reason: "too_many_requests_token" },
        keyGenerator: (req) => {
          const token = rateLimitHelpers.normalizeGetToken(req);
          return `token:${token || "missing"}`;
        },
      },
      "confirm_token"
    );
  },

  // ───────────────────────────────────────────────────────────────────────────
  // /forward/unsubscribe
  // ───────────────────────────────────────────────────────────────────────────
  unsubscribeSlowByIp: slowDown({
    windowMs: 60 * 1000,
    delayAfter: Number(config.sdUnsubscribeDelayAfter ?? 8),
    delayMs: (hits) => {
      const after = Number(config.sdUnsubscribeDelayAfter ?? 8);
      const step = Number(config.sdUnsubscribeDelayStepMs ?? 300);
      return Math.max(0, (hits - after) * step);
    },
    keyGenerator: keyByIp,
  }),

  get unsubscribeLimitByIp() {
    return createRateLimiter(
      {
        windowMs: 10 * 60 * 1000,
        limit: Number(config.rlUnsubscribePer10MinPerIp ?? 40),
        skip: () => Number(config.rlUnsubscribePer10MinPerIp ?? 40) === 0,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { error: "rate_limited", where: "unsubscribe", reason: "too_many_requests_ip" },
        keyGenerator: keyByIp,
      },
      "unsub_ip"
    );
  },

  get unsubscribeLimitByAddress() {
    return createRateLimiter(
      {
        windowMs: 60 * 60 * 1000,
        limit: Number(config.rlUnsubscribePerHourPerAddress ?? 6),
        skip: () => Number(config.rlUnsubscribePerHourPerAddress ?? 6) === 0,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { error: "rate_limited", where: "unsubscribe", reason: "too_many_requests_address" },
        keyGenerator: (req) => {
          const address = rateLimitHelpers.normalizeGetAddress(req);
          if (!address) return "unsub_addr:missing";
          return `unsub_addr:${address.slice(0, 254)}`;
        },
      },
      "unsub_addr"
    );
  },

  get unsubscribeConfirmLimitByIp() {
    return createRateLimiter(
      {
        windowMs: 10 * 60 * 1000,
        limit: Number(config.rlUnsubscribeConfirmPer10MinPerIp ?? 120),
        skip: () => Number(config.rlUnsubscribeConfirmPer10MinPerIp ?? 120) === 0,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { error: "rate_limited", where: "unsubscribe_confirm", reason: "too_many_requests_ip" },
        keyGenerator: keyByIp,
      },
      "unsub_confirm_ip"
    );
  },

  get unsubscribeConfirmLimitByToken() {
    return createRateLimiter(
      {
        windowMs: 10 * 60 * 1000,
        limit: Number(config.rlUnsubscribeConfirmPer10MinPerToken ?? 10),
        skip: () => Number(config.rlUnsubscribeConfirmPer10MinPerToken ?? 10) === 0,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: {
          error: "rate_limited",
          where: "unsubscribe_confirm",
          reason: "too_many_requests_token",
        },
        keyGenerator: (req) => {
          const token = rateLimitHelpers.normalizeGetToken(req);
          if (!token) return "unsub_token:missing";
          return `unsub_token:${token.slice(0, 256)}`;
        },
      },
      "unsub_confirm_token"
    );
  },

  // ───────────────────────────────────────────────────────────────────────────
  // /api/checkdns/:target
  // ───────────────────────────────────────────────────────────────────────────
  get checkdnsLimitByTarget() {
    return createRateLimiter(
      {
        windowMs: 10 * 60 * 1000,
        limit: Number(config.rlCheckdnsPer10MinPerTarget ?? 30),
        skip: () => Number(config.rlCheckdnsPer10MinPerTarget ?? 30) === 0,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { error: "rate_limited", where: "checkdns", reason: "too_many_requests_target" },
        keyGenerator: (req) => {
          const target = rateLimitHelpers.normalizeString(req.params?.target || "");
          return `checkdns:${target || "missing"}`;
        },
      },
      "checkdns_target"
    );
  },

  // ───────────────────────────────────────────────────────────────────────────
  // /request/ui
  // ───────────────────────────────────────────────────────────────────────────
  get requestUiLimitByIp() {
    return createRateLimiter(
      {
        windowMs: 60 * 1000,
        limit: Number(config.rlRequestUiPerMinPerIp ?? 60),
        skip: () => Number(config.rlRequestUiPerMinPerIp ?? 60) === 0,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { error: "rate_limited", where: "request_ui", reason: "too_many_requests_ip" },
        keyGenerator: keyByIp,
      },
      "req_ui_ip"
    );
  },

  get requestUiLimitByTarget() {
    return createRateLimiter(
      {
        windowMs: 10 * 60 * 1000,
        limit: Number(config.rlRequestUiPer10MinPerTarget ?? 20),
        skip: () => Number(config.rlRequestUiPer10MinPerTarget ?? 20) === 0,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { error: "rate_limited", where: "request_ui", reason: "too_many_requests_target" },
        keyGenerator: (req) => {
          const target = rateLimitHelpers.normalizeString(req.body?.target || "");
          return `req_ui:${target || "missing"}`;
        },
      },
      "req_ui_target"
    );
  },

  // ───────────────────────────────────────────────────────────────────────────
  // /request/email
  // ───────────────────────────────────────────────────────────────────────────
  get requestEmailLimitByIp() {
    return createRateLimiter(
      {
        windowMs: 10 * 60 * 1000,
        limit: Number(config.rlRequestEmailPer10MinPerIp ?? 20),
        skip: () => Number(config.rlRequestEmailPer10MinPerIp ?? 20) === 0,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { error: "rate_limited", where: "request_email", reason: "too_many_requests_ip" },
        keyGenerator: keyByIp,
      },
      "req_email_ip"
    );
  },

  get requestEmailLimitByTarget() {
    return createRateLimiter(
      {
        windowMs: 60 * 60 * 1000,
        limit: Number(config.rlRequestEmailPerHourPerTarget ?? 3),
        skip: () => Number(config.rlRequestEmailPerHourPerTarget ?? 3) === 0,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { error: "rate_limited", where: "request_email", reason: "too_many_requests_target" },
        keyGenerator: (req) => {
          const target = rateLimitHelpers.normalizeString(req.body?.target || "");
          return `req_email:${target || "missing"}`;
        },
      },
      "req_email_target"
    );
  },

  // ───────────────────────────────────────────────────────────────────────────
  // /api/credentials/create
  // ───────────────────────────────────────────────────────────────────────────
  get credentialsCreateLimitByIp() {
    return createRateLimiter(
      {
        windowMs: 60 * 60 * 1000,
        limit: Number(config.rlCredentialsCreatePerHourPerIp ?? 10),
        skip: () => Number(config.rlCredentialsCreatePerHourPerIp ?? 10) === 0,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { error: "rate_limited", where: "credentials_create", reason: "too_many_requests_ip" },
        keyGenerator: keyByIp,
      },
      "cred_create_ip"
    );
  },

  get credentialsCreateLimitByEmail() {
    return createRateLimiter(
      {
        windowMs: 60 * 60 * 1000,
        limit: Number(config.rlCredentialsCreatePerHourPerEmail ?? 3),
        skip: () => Number(config.rlCredentialsCreatePerHourPerEmail ?? 3) === 0,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { error: "rate_limited", where: "credentials_create", reason: "too_many_requests_email" },
        keyGenerator: (req) => {
          const email = rateLimitHelpers.normalizeEmail(req.body?.email || req.query?.email || "");
          return `cred_create:${email || "missing"}`;
        },
      },
      "cred_create_email"
    );
  },

  // ───────────────────────────────────────────────────────────────────────────
  // /api/credentials/confirm
  // ───────────────────────────────────────────────────────────────────────────
  get credentialsConfirmLimitByIp() {
    return createRateLimiter(
      {
        windowMs: 10 * 60 * 1000,
        limit: Number(config.rlCredentialsConfirmPer10MinPerIp ?? 60),
        skip: () => Number(config.rlCredentialsConfirmPer10MinPerIp ?? 60) === 0,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { error: "rate_limited", where: "credentials_confirm", reason: "too_many_requests_ip" },
        keyGenerator: keyByIp,
      },
      "cred_confirm_ip"
    );
  },

  get credentialsConfirmLimitByToken() {
    return createRateLimiter(
      {
        windowMs: 10 * 60 * 1000,
        limit: Number(config.rlCredentialsConfirmPer10MinPerToken ?? 5),
        skip: () => Number(config.rlCredentialsConfirmPer10MinPerToken ?? 5) === 0,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { error: "rate_limited", where: "credentials_confirm", reason: "too_many_requests_token" },
        keyGenerator: (req) => {
          const token = rateLimitHelpers.normalizeGetToken(req);
          return `cred_confirm:${token || "missing"}`;
        },
      },
      "cred_confirm_token"
    );
  },

  // ───────────────────────────────────────────────────────────────────────────
  // /api/alias/* (authenticated)
  // ───────────────────────────────────────────────────────────────────────────
  get aliasListLimitByKey() {
    return createRateLimiter(
      {
        windowMs: 60 * 1000,
        limit: Number(config.rlAliasListPerMinPerKey ?? 600),
        skip: () => Number(config.rlAliasListPerMinPerKey ?? 600) === 0,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { error: "rate_limited", where: "alias_list", reason: "too_many_requests_key" },
        keyGenerator: (req) => {
          const key = rateLimitHelpers.normalizeString(req.header("X-API-Key") || "");
          return `alias_list:${key.slice(0, 64) || "missing"}`;
        },
      },
      "alias_list_key"
    );
  },

  get aliasCreateLimitByKey() {
    return createRateLimiter(
      {
        windowMs: 60 * 1000,
        limit: Number(config.rlAliasCreatePerMinPerKey ?? 120),
        skip: () => Number(config.rlAliasCreatePerMinPerKey ?? 120) === 0,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { error: "rate_limited", where: "alias_create", reason: "too_many_requests_key" },
        keyGenerator: (req) => {
          const key = rateLimitHelpers.normalizeString(req.header("X-API-Key") || "");
          return `alias_create:${key.slice(0, 64) || "missing"}`;
        },
      },
      "alias_create_key"
    );
  },

  get aliasDeleteLimitByKey() {
    return createRateLimiter(
      {
        windowMs: 60 * 1000,
        limit: Number(config.rlAliasDeletePerMinPerKey ?? 120),
        skip: () => Number(config.rlAliasDeletePerMinPerKey ?? 120) === 0,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { error: "rate_limited", where: "alias_delete", reason: "too_many_requests_key" },
        keyGenerator: (req) => {
          const key = rateLimitHelpers.normalizeString(req.header("X-API-Key") || "");
          return `alias_delete:${key.slice(0, 64) || "missing"}`;
        },
      },
      "alias_delete_key"
    );
  },
};

module.exports = { rateLimit };
