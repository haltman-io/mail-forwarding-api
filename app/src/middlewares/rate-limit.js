"use strict";

/**
 * @fileoverview Rate limit and slow-down middlewares.
 */

const { config } = require("../config");
const { rateLimitHelpers } = require("./rate-limit-helpers");

const { rateLimit: createRateLimit, ipKeyGenerator } = require("express-rate-limit");
const slowDown = require("express-slow-down");

const globalLimit = Number(config.rlGlobalPerMin ?? 300);
const keyByIp = (req) => ipKeyGenerator(req.ip);

const rateLimit = {
  helpers: rateLimitHelpers,

  globalLimiter: createRateLimit({
    windowMs: 60 * 1000,
    limit: globalLimit || 1,
    skip: () => globalLimit === 0,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  }),

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

  subscribeLimitByIp: createRateLimit({
    windowMs: 10 * 60 * 1000,
    limit: globalLimit || 1,
    skip: () => globalLimit === 0,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "rate_limited", where: "subscribe", reason: "too_many_requests_ip" },
    keyGenerator: keyByIp,
  }),

  subscribeLimitByTo: createRateLimit({
    windowMs: 60 * 60 * 1000,
    limit: globalLimit || 1,
    skip: () => globalLimit === 0,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "rate_limited", where: "subscribe", reason: "too_many_requests_to" },
    keyGenerator: (req) => {
      const to = rateLimitHelpers.normalizeGetTo(req);
      return `to:${to || "missing"}`;
    },
  }),

  subscribeLimitByAlias: createRateLimit({
    windowMs: 60 * 60 * 1000,
    limit: globalLimit || 1,
    skip: () => globalLimit === 0,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "rate_limited", where: "subscribe", reason: "too_many_requests_alias" },
    keyGenerator: (req) => {
      const name = rateLimitHelpers.normalizeGetName(req);
      const domain = rateLimitHelpers.normalizeGetDomain(req) || "default";
      return `alias:${domain}:${name || "missing"}`;
    },
  }),

  confirmLimitByIp: createRateLimit({
    windowMs: 10 * 60 * 1000,
    limit: globalLimit || 1,
    skip: () => globalLimit === 0,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "rate_limited", where: "confirm", reason: "too_many_requests_ip" },
    keyGenerator: keyByIp,
  }),

  confirmLimitByToken: createRateLimit({
    windowMs: 10 * 60 * 1000,
    limit: globalLimit || 1,
    skip: () => globalLimit === 0,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "rate_limited", where: "confirm", reason: "too_many_requests_token" },
    keyGenerator: (req) => {
      const token = rateLimitHelpers.normalizeGetToken(req);
      return `token:${token || "missing"}`;
    },
  }),

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

  unsubscribeLimitByIp: createRateLimit({
    windowMs: 10 * 60 * 1000,
    limit: globalLimit || 1,
    skip: () => globalLimit === 0,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "rate_limited", where: "unsubscribe", reason: "too_many_requests_ip" },
    keyGenerator: keyByIp,
  }),

  unsubscribeLimitByAddress: createRateLimit({
    windowMs: 60 * 60 * 1000,
    limit: globalLimit || 1,
    skip: () => globalLimit === 0,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "rate_limited", where: "unsubscribe", reason: "too_many_requests_address" },
    keyGenerator: (req) => {
      const address = rateLimitHelpers.normalizeGetAddress(req);
      if (!address) return "unsub_addr:missing";
      return `unsub_addr:${address.slice(0, 254)}`;
    },
  }),

  unsubscribeConfirmLimitByIp: createRateLimit({
    windowMs: 10 * 60 * 1000,
    limit: globalLimit || 1,
    skip: () => globalLimit === 0,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "rate_limited", where: "unsubscribe_confirm", reason: "too_many_requests_ip" },
    keyGenerator: keyByIp,
  }),

  unsubscribeConfirmLimitByToken: createRateLimit({
    windowMs: 10 * 60 * 1000,
    limit: globalLimit || 1,
    skip: () => globalLimit === 0,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "rate_limited", where: "unsubscribe_confirm", reason: "too_many_requests_token" },
    keyGenerator: (req) => {
      const token = rateLimitHelpers.normalizeGetToken(req);
      if (!token) return "unsub_token:missing";
      return `unsub_token:${token.slice(0, 256)}`;
    },
  }),
};

module.exports = { rateLimit };
