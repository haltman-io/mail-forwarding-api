import { Injectable, type NestMiddleware } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { NextFunction, Request, Response } from "express";
import type { RedisClientType } from "redis";

import { AppLogger } from "../../logging/app-logger.service.js";
import { RedisService } from "../../redis/redis.service.js";
import {
  keyByIp,
  normalizeApiKey,
  normalizeAuthEmail,
  normalizeAuthIdentifier,
  normalizeBodyTarget,
  normalizeBodyToken,
  normalizeCredentialEmail,
  normalizeGetAddress,
  normalizeGetDomain,
  normalizeGetName,
  normalizeGetTo,
  normalizeGetToken,
  normalizeRouteTarget,
} from "./rate-limit.helpers.js";

type RateLimitSettings = {
  redisPrefix: string;
  globalPerMin: number;
  subscribeSlowDelayAfter: number;
  subscribeSlowDelayStepMs: number;
  subscribePer10MinPerIp: number;
  subscribePerHourPerTo: number;
  subscribePerHourPerAlias: number;
  confirmPer10MinPerIp: number;
  confirmPer10MinPerToken: number;
  unsubscribeSlowDelayAfter: number;
  unsubscribeSlowDelayStepMs: number;
  unsubscribePer10MinPerIp: number;
  unsubscribePerHourPerAddress: number;
  checkdnsPer10MinPerTarget: number;
  requestUiPerMinPerIp: number;
  requestUiPer10MinPerTarget: number;
  requestEmailPer10MinPerIp: number;
  requestEmailPerHourPerTarget: number;
  credentialsCreatePerHourPerIp: number;
  credentialsCreatePerHourPerEmail: number;
  credentialsConfirmPer10MinPerIp: number;
  credentialsConfirmPer10MinPerToken: number;
  authRegisterPerHourPerIp: number;
  authRegisterPerHourPerEmail: number;
  authRegisterConfirmPer10MinPerIp: number;
  authRegisterConfirmPer10MinPerToken: number;
  authPasswordResetRequestPerHourPerIp: number;
  authPasswordResetRequestPerHourPerEmail: number;
  authPasswordResetConfirmPer10MinPerIp: number;
  authPasswordResetConfirmPer10MinPerToken: number;
  authLoginFailPer15MinPerIp: number;
  authLoginFailPerHourPerIdentifier: number;
  authLoginFailPer6HoursPerIdentifierIp: number;
  authLoginFailPer5MinPerIdentifierIp: number;
  aliasListPerMinPerKey: number;
  aliasCreatePerMinPerKey: number;
  aliasDeletePerMinPerKey: number;
};

type CounterState = {
  count: number;
  resetMs: number;
};

type RuleBase = {
  name: string;
  windowMs: number;
  key: (request: Request) => string;
};

type DelayRule = RuleBase & {
  kind: "delay";
  delayAfter: number;
  delayMs: (hits: number) => number;
};

type LimitRule = RuleBase & {
  kind: "limit";
  limit: number;
  message: string | Record<string, unknown>;
  countOnFailureOnly?: boolean;
};

type Rule = DelayRule | LimitRule;

type MemoryCounter = {
  count: number;
  expiresAt: number;
};

const GLOBAL_LIMIT_MESSAGE = "Too many requests, please try again later.";
const REDIS_BACKOFF_MS = 10_000;
const MEMORY_CLEANUP_THRESHOLD = 5_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class RouteRateLimitMiddleware implements NestMiddleware {
  private readonly settings: RateLimitSettings;
  private readonly counters = new Map<string, MemoryCounter>();
  private readonly redisKeyPrefix: string;
  private redisUnavailableUntil = 0;

  constructor(
    configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly logger: AppLogger,
  ) {
    this.settings = configService.getOrThrow<RateLimitSettings>("rateLimit");
    this.redisKeyPrefix = this.settings.redisPrefix || "rl:";
  }

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const rules = this.resolveRules(req);
    if (rules.length === 0) {
      next();
      return;
    }

    try {
      const deferredFailureRules: Array<{ rule: LimitRule; key: string }> = [];

      for (const rule of rules) {
        if (rule.kind === "delay") {
          const delayed = await this.applyDelayRule(rule, req);
          if (delayed > 0) {
            await sleep(delayed);
          }
          continue;
        }

        if (rule.countOnFailureOnly) {
          const failureRuleResult = await this.checkFailureOnlyLimitRule(rule, req, res);
          if (failureRuleResult.limited) {
            return;
          }
          if (failureRuleResult.key) {
            deferredFailureRules.push({ rule, key: failureRuleResult.key });
          }
          continue;
        }

        const limited = await this.applyLimitRule(rule, req, res);
        if (limited) {
          return;
        }
      }

      for (const deferredRule of deferredFailureRules) {
        this.attachFailureIncrement(deferredRule.rule, deferredRule.key, res);
      }

      next();
    } catch (error) {
      this.logger.logError("ratelimit.middleware.error", error, req);
      next();
    }
  }

  private resolveRules(req: Request): Rule[] {
    const method = req.method.toUpperCase();
    const path = req.path;

    if (method === "GET" && path === "/forward/subscribe") {
      return [
        this.globalLimitRule(),
        {
          kind: "delay",
          name: "sub_slow_ip",
          windowMs: 60_000,
          delayAfter: this.settings.subscribeSlowDelayAfter,
          delayMs: (hits) =>
            Math.max(
              0,
              (hits - this.settings.subscribeSlowDelayAfter) *
                this.settings.subscribeSlowDelayStepMs,
            ),
          key: keyByIp,
        },
        {
          kind: "limit",
          name: "sub_ip",
          windowMs: 10 * 60_000,
          limit: this.settings.subscribePer10MinPerIp,
          message: {
            error: "rate_limited",
            where: "subscribe",
            reason: "too_many_requests_ip",
          },
          key: keyByIp,
        },
        {
          kind: "limit",
          name: "sub_to",
          windowMs: 60 * 60_000,
          limit: this.settings.subscribePerHourPerTo,
          message: {
            error: "rate_limited",
            where: "subscribe",
            reason: "too_many_requests_to",
          },
          key: (request) => `to:${normalizeGetTo(request) || "missing"}`,
        },
        {
          kind: "limit",
          name: "sub_alias",
          windowMs: 60 * 60_000,
          limit: this.settings.subscribePerHourPerAlias,
          message: {
            error: "rate_limited",
            where: "subscribe",
            reason: "too_many_requests_alias",
          },
          key: (request) =>
            `alias:${normalizeGetDomain(request) || "default"}:${normalizeGetName(request) || "missing"}`,
        },
      ];
    }

    if (method === "GET" && path === "/forward/unsubscribe") {
      return [
        this.globalLimitRule(),
        {
          kind: "delay",
          name: "unsub_slow_ip",
          windowMs: 60_000,
          delayAfter: this.settings.unsubscribeSlowDelayAfter,
          delayMs: (hits) =>
            Math.max(
              0,
              (hits - this.settings.unsubscribeSlowDelayAfter) *
                this.settings.unsubscribeSlowDelayStepMs,
            ),
          key: keyByIp,
        },
        {
          kind: "limit",
          name: "unsub_ip",
          windowMs: 10 * 60_000,
          limit: this.settings.unsubscribePer10MinPerIp,
          message: {
            error: "rate_limited",
            where: "unsubscribe",
            reason: "too_many_requests_ip",
          },
          key: keyByIp,
        },
        {
          kind: "limit",
          name: "unsub_addr",
          windowMs: 60 * 60_000,
          limit: this.settings.unsubscribePerHourPerAddress,
          message: {
            error: "rate_limited",
            where: "unsubscribe",
            reason: "too_many_requests_address",
          },
          key: (request) => {
            const address = normalizeGetAddress(request);
            return address ? `unsub_addr:${address.slice(0, 254)}` : "unsub_addr:missing";
          },
        },
      ];
    }

    if (method === "GET" && path === "/forward/confirm") {
      return [
        this.globalLimitRule(),
        {
          kind: "limit",
          name: "confirm_ip",
          windowMs: 10 * 60_000,
          limit: this.settings.confirmPer10MinPerIp,
          message: {
            error: "rate_limited",
            where: "confirm",
            reason: "too_many_requests_ip",
          },
          key: keyByIp,
        },
        {
          kind: "limit",
          name: "confirm_token",
          windowMs: 10 * 60_000,
          limit: this.settings.confirmPer10MinPerToken,
          message: {
            error: "rate_limited",
            where: "confirm",
            reason: "too_many_requests_token",
          },
          key: (request) => `token:${normalizeGetToken(request) || "missing"}`,
        },
      ];
    }

    if (method === "POST" && path === "/request/ui") {
      return [
        this.globalLimitRule(),
        {
          kind: "limit",
          name: "req_ui_ip",
          windowMs: 60_000,
          limit: this.settings.requestUiPerMinPerIp,
          message: {
            error: "rate_limited",
            where: "request_ui",
            reason: "too_many_requests_ip",
          },
          key: keyByIp,
        },
        {
          kind: "limit",
          name: "req_ui_target",
          windowMs: 10 * 60_000,
          limit: this.settings.requestUiPer10MinPerTarget,
          message: {
            error: "rate_limited",
            where: "request_ui",
            reason: "too_many_requests_target",
          },
          key: (request) => `req_ui:${normalizeBodyTarget(request) || "missing"}`,
        },
      ];
    }

    if (method === "POST" && path === "/request/email") {
      return [
        this.globalLimitRule(),
        {
          kind: "limit",
          name: "req_email_ip",
          windowMs: 10 * 60_000,
          limit: this.settings.requestEmailPer10MinPerIp,
          message: {
            error: "rate_limited",
            where: "request_email",
            reason: "too_many_requests_ip",
          },
          key: keyByIp,
        },
        {
          kind: "limit",
          name: "req_email_target",
          windowMs: 60 * 60_000,
          limit: this.settings.requestEmailPerHourPerTarget,
          message: {
            error: "rate_limited",
            where: "request_email",
            reason: "too_many_requests_target",
          },
          key: (request) => `req_email:${normalizeBodyTarget(request) || "missing"}`,
        },
      ];
    }

    if (method === "GET" && /^\/api\/checkdns\/[^/]+$/.test(path)) {
      return [
        this.globalLimitRule(),
        {
          kind: "limit",
          name: "checkdns_target",
          windowMs: 10 * 60_000,
          limit: this.settings.checkdnsPer10MinPerTarget,
          message: {
            error: "rate_limited",
            where: "checkdns",
            reason: "too_many_requests_target",
          },
          key: (request) => `checkdns:${normalizeRouteTarget(request) || "missing"}`,
        },
      ];
    }

    if (method === "POST" && path === "/api/credentials/create") {
      return [
        this.globalLimitRule(),
        {
          kind: "limit",
          name: "cred_create_ip",
          windowMs: 60 * 60_000,
          limit: this.settings.credentialsCreatePerHourPerIp,
          message: {
            error: "rate_limited",
            where: "credentials_create",
            reason: "too_many_requests_ip",
          },
          key: keyByIp,
        },
        {
          kind: "limit",
          name: "cred_create_email",
          windowMs: 60 * 60_000,
          limit: this.settings.credentialsCreatePerHourPerEmail,
          message: {
            error: "rate_limited",
            where: "credentials_create",
            reason: "too_many_requests_email",
          },
          key: (request) => `cred_create:${normalizeCredentialEmail(request) || "missing"}`,
        },
      ];
    }

    if (method === "GET" && path === "/api/credentials/confirm") {
      return [
        this.globalLimitRule(),
        {
          kind: "limit",
          name: "cred_confirm_ip",
          windowMs: 10 * 60_000,
          limit: this.settings.credentialsConfirmPer10MinPerIp,
          message: {
            error: "rate_limited",
            where: "credentials_confirm",
            reason: "too_many_requests_ip",
          },
          key: keyByIp,
        },
        {
          kind: "limit",
          name: "cred_confirm_token",
          windowMs: 10 * 60_000,
          limit: this.settings.credentialsConfirmPer10MinPerToken,
          message: {
            error: "rate_limited",
            where: "credentials_confirm",
            reason: "too_many_requests_token",
          },
          key: (request) => `cred_confirm:${normalizeGetToken(request) || "missing"}`,
        },
      ];
    }

    if (method === "POST" && path === "/auth/sign-up") {
      return [
        this.globalLimitRule(),
        {
          kind: "limit",
          name: "auth_register_ip",
          windowMs: 60 * 60_000,
          limit: this.settings.authRegisterPerHourPerIp,
          message: {
            error: "rate_limited",
            where: "auth_register",
            reason: "too_many_registrations_ip",
          },
          key: keyByIp,
        },
        {
          kind: "limit",
          name: "auth_register_email",
          windowMs: 60 * 60_000,
          limit: this.settings.authRegisterPerHourPerEmail,
          message: {
            error: "rate_limited",
            where: "auth_register",
            reason: "too_many_registrations_email",
          },
          key: (request) => `auth_register:${normalizeAuthEmail(request) || "missing"}`,
        },
      ];
    }

    if (method === "POST" && path === "/auth/verify-email") {
      return [
        this.globalLimitRule(),
        {
          kind: "limit",
          name: "auth_register_confirm_ip",
          windowMs: 10 * 60_000,
          limit: this.settings.authRegisterConfirmPer10MinPerIp,
          message: {
            error: "rate_limited",
            where: "auth_register_confirm",
            reason: "too_many_requests_ip",
          },
          key: keyByIp,
        },
        {
          kind: "limit",
          name: "auth_register_confirm_token",
          windowMs: 10 * 60_000,
          limit: this.settings.authRegisterConfirmPer10MinPerToken,
          message: {
            error: "rate_limited",
            where: "auth_register_confirm",
            reason: "too_many_requests_token",
          },
          key: (request) => `auth_register_confirm:${normalizeBodyToken(request) || "missing"}`,
        },
      ];
    }

    if (method === "POST" && path === "/auth/sign-in") {
      return [
        this.globalLimitRule(),
        {
          kind: "limit",
          name: "auth_login_fail_ip",
          windowMs: 15 * 60_000,
          limit: this.settings.authLoginFailPer15MinPerIp,
          countOnFailureOnly: true,
          message: {
            error: "rate_limited",
            where: "auth_login",
            reason: "too_many_failed_attempts_ip",
          },
          key: keyByIp,
        },
        {
          kind: "limit",
          name: "auth_login_fail_identifier",
          windowMs: 60 * 60_000,
          limit: this.settings.authLoginFailPerHourPerIdentifier,
          countOnFailureOnly: true,
          message: {
            error: "rate_limited",
            where: "auth_login",
            reason: "too_many_failed_attempts_identifier",
          },
          key: (request) => `auth_login_identifier:${normalizeAuthIdentifier(request) || "missing"}`,
        },
        {
          kind: "limit",
          name: "auth_login_fail_heavy_identifier_ip",
          windowMs: 6 * 60 * 60_000,
          limit: this.settings.authLoginFailPer6HoursPerIdentifierIp,
          countOnFailureOnly: true,
          message: {
            error: "rate_limited",
            where: "auth_login",
            reason: "too_many_failed_attempts_identifier_ip_heavy",
          },
          key: (request) => {
            const identifier = normalizeAuthIdentifier(request) || "missing";
            return `auth_login_heavy:${identifier}:${keyByIp(request)}`;
          },
        },
        {
          kind: "limit",
          name: "auth_login_fail_fast_identifier_ip",
          windowMs: 5 * 60_000,
          limit: this.settings.authLoginFailPer5MinPerIdentifierIp,
          countOnFailureOnly: true,
          message: {
            error: "rate_limited",
            where: "auth_login",
            reason: "too_many_failed_attempts_identifier_ip",
          },
          key: (request) => {
            const identifier = normalizeAuthIdentifier(request) || "missing";
            return `auth_login_fast:${identifier}:${keyByIp(request)}`;
          },
        },
      ];
    }

    if (method === "POST" && path === "/auth/forgot-password") {
      return [
        this.globalLimitRule(),
        {
          kind: "limit",
          name: "auth_password_reset_request_ip",
          windowMs: 60 * 60_000,
          limit: this.settings.authPasswordResetRequestPerHourPerIp,
          message: {
            error: "rate_limited",
            where: "auth_password_reset_request",
            reason: "too_many_requests_ip",
          },
          key: keyByIp,
        },
        {
          kind: "limit",
          name: "auth_password_reset_request_email",
          windowMs: 60 * 60_000,
          limit: this.settings.authPasswordResetRequestPerHourPerEmail,
          message: {
            error: "rate_limited",
            where: "auth_password_reset_request",
            reason: "too_many_requests_email",
          },
          key: (request) => `auth_password_reset_request:${normalizeAuthEmail(request) || "missing"}`,
        },
      ];
    }

    if (method === "POST" && path === "/auth/reset-password") {
      return [
        this.globalLimitRule(),
        {
          kind: "limit",
          name: "auth_password_reset_confirm_ip",
          windowMs: 10 * 60_000,
          limit: this.settings.authPasswordResetConfirmPer10MinPerIp,
          message: {
            error: "rate_limited",
            where: "auth_password_reset_confirm",
            reason: "too_many_requests_ip",
          },
          key: keyByIp,
        },
        {
          kind: "limit",
          name: "auth_password_reset_confirm_token",
          windowMs: 10 * 60_000,
          limit: this.settings.authPasswordResetConfirmPer10MinPerToken,
          message: {
            error: "rate_limited",
            where: "auth_password_reset_confirm",
            reason: "too_many_requests_token",
          },
          key: (request) => `auth_password_reset_confirm:${normalizeBodyToken(request) || "missing"}`,
        },
      ];
    }

    if (
      (method === "GET" && path === "/auth/csrf") ||
      (method === "GET" && path === "/auth/session") ||
      (method === "POST" && ["/auth/refresh", "/auth/sign-out", "/auth/sign-out-all"].includes(path))
    ) {
      return [this.globalLimitRule()];
    }

    if (
      method === "GET" &&
      ["/api/alias/list", "/api/alias/stats", "/api/activity"].includes(path)
    ) {
      return [this.globalLimitRule(), this.aliasLimitRule("alias_list_key", this.settings.aliasListPerMinPerKey, "alias_list")];
    }

    if (method === "POST" && path === "/api/alias/create") {
      return [this.globalLimitRule(), this.aliasLimitRule("alias_create_key", this.settings.aliasCreatePerMinPerKey, "alias_create")];
    }

    if (method === "POST" && path === "/api/alias/delete") {
      return [this.globalLimitRule(), this.aliasLimitRule("alias_delete_key", this.settings.aliasDeletePerMinPerKey, "alias_delete")];
    }

    return [];
  }

  private globalLimitRule(): LimitRule {
    return {
      kind: "limit",
      name: "global",
      windowMs: 60_000,
      limit: this.settings.globalPerMin,
      message: GLOBAL_LIMIT_MESSAGE,
      key: keyByIp,
    };
  }

  private aliasLimitRule(
    name: string,
    limit: number,
    where: "alias_list" | "alias_create" | "alias_delete",
  ): LimitRule {
    return {
      kind: "limit",
      name,
      windowMs: 60_000,
      limit,
      message: {
        error: "rate_limited",
        where,
        reason: "too_many_requests_key",
      },
      key: (request) => {
        const key = normalizeApiKey(request);
        return key ? `${where}:${key.slice(0, 64)}` : "";
      },
    };
  }

  private async applyDelayRule(rule: DelayRule, req: Request): Promise<number> {
    if (rule.delayAfter <= 0) {
      return 0;
    }

    const key = rule.key(req);
    if (!key) {
      return 0;
    }

    const state = await this.increment(rule.name, key, rule.windowMs);
    if (state.count <= rule.delayAfter) {
      return 0;
    }

    return rule.delayMs(state.count);
  }

  private async applyLimitRule(
    rule: LimitRule,
    req: Request,
    res: Response,
  ): Promise<boolean> {
    if (rule.limit <= 0) {
      return false;
    }

    const key = rule.key(req);
    if (!key) {
      return false;
    }

    const state = await this.increment(rule.name, key, rule.windowMs);
    if (state.count <= rule.limit) {
      return false;
    }

    res.setHeader("Retry-After", String(Math.max(1, Math.ceil(state.resetMs / 1000))));

    if (typeof rule.message === "string") {
      res.status(429).send(rule.message);
      return true;
    }

    res.status(429).json(rule.message);
    return true;
  }

  private async checkFailureOnlyLimitRule(
    rule: LimitRule,
    req: Request,
    res: Response,
  ): Promise<{ limited: boolean; key: string }> {
    if (rule.limit <= 0) {
      return { limited: false, key: "" };
    }

    const key = rule.key(req);
    if (!key) {
      return { limited: false, key: "" };
    }

    const state = await this.getCurrentState(rule.name, key, rule.windowMs);
    if (state.count < rule.limit) {
      return { limited: false, key };
    }

    res.setHeader("Retry-After", String(Math.max(1, Math.ceil(state.resetMs / 1000))));
    if (typeof rule.message === "string") {
      res.status(429).send(rule.message);
      return { limited: true, key: "" };
    }

    res.status(429).json(rule.message);
    return { limited: true, key: "" };
  }

  private attachFailureIncrement(rule: LimitRule, key: string, res: Response): void {
    let handled = false;
    res.once("finish", () => {
      if (handled) return;
      handled = true;
      if (res.statusCode >= 200 && res.statusCode < 300) {
        return;
      }

      void this.increment(rule.name, key, rule.windowMs).catch((error) => {
        this.logger.warn("ratelimit.failure.increment.error", {
          err: error,
          rule: rule.name,
        });
      });
    });
  }

  private async increment(ruleName: string, key: string, windowMs: number): Promise<CounterState> {
    const namespacedKey = `${this.redisKeyPrefix}${ruleName}:${key}`;
    const redisClient = await this.getRedisClientOrNull();
    if (redisClient) {
      try {
        const count = Number(await redisClient.incr(namespacedKey));
        let ttl = Number(await redisClient.pTTL(namespacedKey));
        if (ttl <= 0) {
          await redisClient.pExpire(namespacedKey, windowMs);
          ttl = windowMs;
        }

        return {
          count,
          resetMs: ttl,
        };
      } catch (error) {
        this.noteRedisFailure(error);
      }
    }

    return this.incrementMemory(namespacedKey, windowMs);
  }

  private async getCurrentState(
    ruleName: string,
    key: string,
    windowMs: number,
  ): Promise<CounterState> {
    const namespacedKey = `${this.redisKeyPrefix}${ruleName}:${key}`;
    const redisClient = await this.getRedisClientOrNull();
    if (redisClient) {
      try {
        const count = Number(await redisClient.get(namespacedKey)) || 0;
        const ttl = Number(await redisClient.pTTL(namespacedKey));
        return {
          count,
          resetMs: ttl > 0 ? ttl : windowMs,
        };
      } catch (error) {
        this.noteRedisFailure(error);
      }
    }

    return this.getMemoryState(namespacedKey, windowMs);
  }

  private incrementMemory(key: string, windowMs: number): CounterState {
    const now = Date.now();
    const existing = this.counters.get(key);

    if (!existing || existing.expiresAt <= now) {
      this.counters.set(key, {
        count: 1,
        expiresAt: now + windowMs,
      });

      this.cleanupMemoryIfNeeded(now);
      return {
        count: 1,
        resetMs: windowMs,
      };
    }

    existing.count += 1;

    return {
      count: existing.count,
      resetMs: Math.max(1, existing.expiresAt - now),
    };
  }

  private getMemoryState(key: string, windowMs: number): CounterState {
    const now = Date.now();
    const existing = this.counters.get(key);
    if (!existing || existing.expiresAt <= now) {
      if (existing && existing.expiresAt <= now) {
        this.counters.delete(key);
      }
      return {
        count: 0,
        resetMs: windowMs,
      };
    }

    return {
      count: existing.count,
      resetMs: Math.max(1, existing.expiresAt - now),
    };
  }

  private cleanupMemoryIfNeeded(now: number): void {
    if (this.counters.size < MEMORY_CLEANUP_THRESHOLD) {
      return;
    }

    for (const [key, value] of this.counters.entries()) {
      if (value.expiresAt <= now) {
        this.counters.delete(key);
      }
    }
  }

  private async getRedisClientOrNull(): Promise<RedisClientType | null> {
    if (!this.redisService.isConfigured()) {
      return null;
    }

    if (this.redisUnavailableUntil > Date.now()) {
      return null;
    }

    try {
      return await this.redisService.getClient();
    } catch (error) {
      this.noteRedisFailure(error);
      return null;
    }
  }

  private noteRedisFailure(error: unknown): void {
    this.redisUnavailableUntil = Date.now() + REDIS_BACKOFF_MS;
    this.logger.warn("ratelimit.redis.unavailable", {
      err: error,
      backoff_ms: REDIS_BACKOFF_MS,
      fallback: "memory",
    });
  }
}
