import net from "node:net";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { RedisClientType } from "redis";

import { PublicHttpException } from "../../../shared/errors/public-http.exception.js";
import { AppLogger } from "../../../shared/logging/app-logger.service.js";
import { RedisService } from "../../../shared/redis/redis.service.js";
import { normalizeDomainTarget } from "../../../shared/validation/domain-target.js";
import {
  isValidDomain,
  isValidLocalPart,
  parseMailbox,
} from "../../../shared/validation/mailbox.js";
import type { AdminRateLimitTargetDto } from "../dto/admin.dto.js";

type RateLimitTargetType = "auto" | "ip" | "email" | "handle" | "domain";
type ResolvedRateLimitTargetType = Exclude<RateLimitTargetType, "auto">;

type RateLimitSettings = {
  redisPrefix: string;
};

type ParsedRateLimitKey = {
  key: string;
  rule: string;
  bucket: string;
};

type ResolvedRateLimitTarget = {
  requestedType: RateLimitTargetType;
  type: ResolvedRateLimitTargetType;
  target: string;
  ipCandidates: string[];
};

type RedisAvailability =
  | { configured: true; available: true; client: RedisClientType }
  | { configured: boolean; available: false; reason: "redis_not_configured" | "redis_unavailable" };

type MatchedRateLimitKey = {
  key: string;
  rule: string;
};

type RateLimitKeyState = MatchedRateLimitKey & {
  count: number | null;
  ttl_ms: number;
};

const DEFAULT_REDIS_PREFIX = "rl:";
const SCAN_COUNT = 500;
const DELETE_BATCH_SIZE = 100;

@Injectable()
export class AdminRateLimitService {
  private readonly redisPrefix: string;

  constructor(
    configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly logger: AppLogger,
  ) {
    const rateLimitSettings = configService.getOrThrow<RateLimitSettings>("rateLimit");
    this.redisPrefix = rateLimitSettings.redisPrefix || DEFAULT_REDIS_PREFIX;
  }

  async checkRateLimit(dto: AdminRateLimitTargetDto): Promise<{
    ok: true;
    target: string;
    type: RateLimitTargetType;
    resolved_type: ResolvedRateLimitTargetType;
    redis_configured: boolean;
    redis_available: boolean;
    reason?: "redis_not_configured" | "redis_unavailable";
    active_keys_count: number;
    items: RateLimitKeyState[];
  }> {
    const resolved = this.resolveTarget(dto);
    const redis = await this.getRedisAvailability();
    if (!redis.available) {
      return {
        ...this.baseResponse(resolved, redis),
        active_keys_count: 0,
        items: [],
      };
    }

    try {
      const matched = await this.scanMatchingKeys(redis.client, resolved);
      const items = await this.readKeyStates(redis.client, matched);
      return {
        ...this.baseResponse(resolved, redis),
        active_keys_count: items.length,
        items,
      };
    } catch (error) {
      this.logger.warn("admin.rate_limit.check.redis_unavailable", { err: error });
      return {
        ...this.baseResponse(resolved, {
          configured: true,
          available: false,
          reason: "redis_unavailable",
        }),
        active_keys_count: 0,
        items: [],
      };
    }
  }

  async resetRateLimit(dto: AdminRateLimitTargetDto): Promise<{
    ok: true;
    target: string;
    type: RateLimitTargetType;
    resolved_type: ResolvedRateLimitTargetType;
    redis_configured: boolean;
    redis_available: boolean;
    reason?: "redis_not_configured" | "redis_unavailable";
    deleted_keys_count: number;
    cleared_rules: string[];
  }> {
    const resolved = this.resolveTarget(dto);
    const redis = await this.getRedisAvailability();
    if (!redis.available) {
      return {
        ...this.baseResponse(resolved, redis),
        deleted_keys_count: 0,
        cleared_rules: [],
      };
    }

    try {
      const matched = await this.scanMatchingKeys(redis.client, resolved);
      const deletedKeysCount = await this.deleteKeys(redis.client, matched.map((item) => item.key));
      return {
        ...this.baseResponse(resolved, redis),
        deleted_keys_count: deletedKeysCount,
        cleared_rules: this.uniqueSorted(matched.map((item) => item.rule)),
      };
    } catch (error) {
      this.logger.warn("admin.rate_limit.reset.redis_unavailable", { err: error });
      return {
        ...this.baseResponse(resolved, {
          configured: true,
          available: false,
          reason: "redis_unavailable",
        }),
        deleted_keys_count: 0,
        cleared_rules: [],
      };
    }
  }

  private baseResponse(
    resolved: ResolvedRateLimitTarget,
    redis: RedisAvailability,
  ): {
    ok: true;
    target: string;
    type: RateLimitTargetType;
    resolved_type: ResolvedRateLimitTargetType;
    redis_configured: boolean;
    redis_available: boolean;
    reason?: "redis_not_configured" | "redis_unavailable";
  } {
    const response: {
      ok: true;
      target: string;
      type: RateLimitTargetType;
      resolved_type: ResolvedRateLimitTargetType;
      redis_configured: boolean;
      redis_available: boolean;
      reason?: "redis_not_configured" | "redis_unavailable";
    } = {
      ok: true,
      target: resolved.target,
      type: resolved.requestedType,
      resolved_type: resolved.type,
      redis_configured: redis.configured,
      redis_available: redis.available,
    };

    if (!redis.available) {
      response.reason = redis.reason;
    }

    return response;
  }

  private resolveTarget(dto: AdminRateLimitTargetDto): ResolvedRateLimitTarget {
    const requestedType = this.normalizeRequestedType(dto.type);
    const rawTarget = String(dto.target || "").trim().toLowerCase();
    if (!rawTarget) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "target" });
    }

    const type = requestedType === "auto"
      ? this.detectTargetType(rawTarget)
      : requestedType;
    const target = this.normalizeTargetForType(rawTarget, type);

    return {
      requestedType,
      type,
      target,
      ipCandidates: type === "ip" ? this.ipCandidates(target) : [],
    };
  }

  private normalizeRequestedType(value: unknown): RateLimitTargetType {
    if (value === undefined || value === null || value === "") {
      return "auto";
    }

    if (typeof value !== "string") {
      throw new PublicHttpException(400, { error: "invalid_params", field: "type" });
    }

    const type = value.trim().toLowerCase();
    if (
      type === "auto" ||
      type === "ip" ||
      type === "email" ||
      type === "handle" ||
      type === "domain"
    ) {
      return type;
    }

    throw new PublicHttpException(400, { error: "invalid_params", field: "type" });
  }

  private detectTargetType(target: string): ResolvedRateLimitTargetType {
    if (net.isIP(target)) return "ip";
    if (parseMailbox(target)) return "email";
    if (isValidDomain(target)) return "domain";
    if (isValidLocalPart(target)) return "handle";

    throw new PublicHttpException(400, { error: "invalid_params", field: "target" });
  }

  private normalizeTargetForType(
    target: string,
    type: ResolvedRateLimitTargetType,
  ): string {
    if (type === "ip") {
      return net.isIP(target) ? target : this.invalidTarget();
    }

    if (type === "email") {
      return parseMailbox(target)?.email ?? this.invalidTarget();
    }

    if (type === "domain") {
      const normalized = normalizeDomainTarget(target);
      return normalized.ok ? normalized.value : this.invalidTarget();
    }

    return isValidLocalPart(target) ? target : this.invalidTarget();
  }

  private invalidTarget(): never {
    throw new PublicHttpException(400, { error: "invalid_params", field: "target" });
  }

  private async getRedisAvailability(): Promise<RedisAvailability> {
    const configured = this.redisService.isConfigured();
    if (!configured) {
      return { configured: false, available: false, reason: "redis_not_configured" };
    }

    try {
      const client = await this.redisService.getClient();
      if (!client) {
        return { configured: true, available: false, reason: "redis_unavailable" };
      }

      return { configured: true, available: true, client };
    } catch (error) {
      this.logger.warn("admin.rate_limit.redis_unavailable", { err: error });
      return { configured: true, available: false, reason: "redis_unavailable" };
    }
  }

  private async scanMatchingKeys(
    client: RedisClientType,
    target: ResolvedRateLimitTarget,
  ): Promise<MatchedRateLimitKey[]> {
    const matched: MatchedRateLimitKey[] = [];
    const seen = new Set<string>();

    for await (const keys of client.scanIterator({
      MATCH: `${this.redisPrefix}*`,
      COUNT: SCAN_COUNT,
    })) {
      for (const rawKey of keys) {
        const parsed = this.parseRateLimitKey(String(rawKey));
        if (!parsed || seen.has(parsed.key) || !this.matchesTarget(parsed, target)) {
          continue;
        }

        seen.add(parsed.key);
        matched.push({ key: parsed.key, rule: parsed.rule });
      }
    }

    return matched.sort((a, b) => a.key.localeCompare(b.key));
  }

  private parseRateLimitKey(key: string): ParsedRateLimitKey | null {
    if (!key.startsWith(this.redisPrefix)) return null;

    const rest = key.slice(this.redisPrefix.length);
    const separatorIndex = rest.indexOf(":");
    if (separatorIndex <= 0) return null;

    return {
      key,
      rule: rest.slice(0, separatorIndex),
      bucket: rest.slice(separatorIndex + 1),
    };
  }

  private matchesTarget(
    parsed: ParsedRateLimitKey,
    target: ResolvedRateLimitTarget,
  ): boolean {
    if (target.type === "ip") {
      return this.matchesIpTarget(parsed, target.ipCandidates);
    }

    if (target.type === "email") {
      return this.matchesEmailTarget(parsed, target.target);
    }

    if (target.type === "domain") {
      return this.matchesDomainTarget(parsed, target.target);
    }

    return this.matchesHandleTarget(parsed, target.target);
  }

  private matchesIpTarget(parsed: ParsedRateLimitKey, ipCandidates: string[]): boolean {
    if (ipCandidates.includes(parsed.bucket)) {
      return true;
    }

    if (
      parsed.rule === "auth_login_fail_heavy_identifier_ip" &&
      parsed.bucket.startsWith("auth_login_heavy:")
    ) {
      return ipCandidates.some((ip) => parsed.bucket.endsWith(`:${ip}`));
    }

    if (
      parsed.rule === "auth_login_fail_fast_identifier_ip" &&
      parsed.bucket.startsWith("auth_login_fast:")
    ) {
      return ipCandidates.some((ip) => parsed.bucket.endsWith(`:${ip}`));
    }

    return false;
  }

  private matchesEmailTarget(parsed: ParsedRateLimitKey, email: string): boolean {
    return this.emailFromParsedKey(parsed) === email;
  }

  private matchesDomainTarget(parsed: ParsedRateLimitKey, domain: string): boolean {
    if (
      parsed.rule === "req_ui_target" &&
      parsed.bucket === `req_ui:${domain}`
    ) {
      return true;
    }

    if (
      parsed.rule === "req_email_target" &&
      parsed.bucket === `req_email:${domain}`
    ) {
      return true;
    }

    if (
      parsed.rule === "checkdns_target" &&
      parsed.bucket === `checkdns:${domain}`
    ) {
      return true;
    }

    if (parsed.rule === "sub_alias") {
      const aliasParts = this.parseAliasBucket(parsed.bucket);
      return aliasParts?.domain === domain;
    }

    return this.emailDomainFromParsedKey(parsed) === domain;
  }

  private matchesHandleTarget(parsed: ParsedRateLimitKey, handle: string): boolean {
    if (
      parsed.rule === "handle_sub_handle" &&
      parsed.bucket === `handle_sub:${handle}`
    ) {
      return true;
    }

    if (
      parsed.rule === "handle_unsub_handle" &&
      parsed.bucket === `handle_unsub:${handle}`
    ) {
      return true;
    }

    if (
      parsed.rule === "handle_domain_handle" &&
      parsed.bucket === `handle_domain:${handle}`
    ) {
      return true;
    }

    if (parsed.rule === "sub_alias") {
      const aliasParts = this.parseAliasBucket(parsed.bucket);
      return aliasParts?.name === handle;
    }

    return false;
  }

  private emailFromParsedKey(parsed: ParsedRateLimitKey): string | null {
    if (parsed.rule === "sub_to" && parsed.bucket.startsWith("to:")) {
      return parsed.bucket.slice("to:".length);
    }

    if (parsed.rule === "handle_sub_to" && parsed.bucket.startsWith("handle_to:")) {
      return parsed.bucket.slice("handle_to:".length);
    }

    if (parsed.rule === "unsub_addr" && parsed.bucket.startsWith("unsub_addr:")) {
      return parsed.bucket.slice("unsub_addr:".length);
    }

    if (parsed.rule === "cred_create_email") {
      return this.emailFromCredentialBucket(parsed.bucket);
    }

    if (
      parsed.rule === "auth_password_reset_request_email" &&
      parsed.bucket.startsWith("auth_password_reset_request:")
    ) {
      return parsed.bucket.slice("auth_password_reset_request:".length);
    }

    if (
      parsed.rule === "auth_login_fail_identifier" &&
      parsed.bucket.startsWith("auth_login_identifier:")
    ) {
      return parsed.bucket.slice("auth_login_identifier:".length);
    }

    if (
      parsed.rule === "auth_login_fail_heavy_identifier_ip" &&
      parsed.bucket.startsWith("auth_login_heavy:")
    ) {
      return this.firstFieldAfterPrefix(parsed.bucket, "auth_login_heavy:");
    }

    if (
      parsed.rule === "auth_login_fail_fast_identifier_ip" &&
      parsed.bucket.startsWith("auth_login_fast:")
    ) {
      return this.firstFieldAfterPrefix(parsed.bucket, "auth_login_fast:");
    }

    return null;
  }

  private emailDomainFromParsedKey(parsed: ParsedRateLimitKey): string | null {
    const email = this.emailFromParsedKey(parsed);
    return email ? parseMailbox(email)?.domain ?? null : null;
  }

  private emailFromCredentialBucket(bucket: string): string | null {
    const prefixes = [
      "credentials_create:",
      "credentials_list_request:",
      "credentials_destroy_all_request:",
    ];

    for (const prefix of prefixes) {
      if (bucket.startsWith(prefix)) {
        return bucket.slice(prefix.length);
      }
    }

    return null;
  }

  private firstFieldAfterPrefix(bucket: string, prefix: string): string | null {
    const rest = bucket.slice(prefix.length);
    const separatorIndex = rest.indexOf(":");
    if (separatorIndex <= 0) return null;

    return rest.slice(0, separatorIndex);
  }

  private parseAliasBucket(bucket: string): { domain: string; name: string } | null {
    if (!bucket.startsWith("alias:")) return null;

    const rest = bucket.slice("alias:".length);
    const separatorIndex = rest.indexOf(":");
    if (separatorIndex <= 0) return null;

    return {
      domain: rest.slice(0, separatorIndex),
      name: rest.slice(separatorIndex + 1),
    };
  }

  private async readKeyStates(
    client: RedisClientType,
    matched: MatchedRateLimitKey[],
  ): Promise<RateLimitKeyState[]> {
    const items: RateLimitKeyState[] = [];

    for (const item of matched) {
      const [ttl, value] = await Promise.all([
        client.pTTL(item.key),
        client.get(item.key),
      ]);
      if (Number(ttl) === -2) {
        continue;
      }

      const count = Number(value);
      items.push({
        ...item,
        count: Number.isFinite(count) ? count : null,
        ttl_ms: Number(ttl),
      });
    }

    return items;
  }

  private async deleteKeys(client: RedisClientType, keys: string[]): Promise<number> {
    let deleted = 0;
    for (let index = 0; index < keys.length; index += DELETE_BATCH_SIZE) {
      const batch = keys.slice(index, index + DELETE_BATCH_SIZE);
      if (batch.length === 0) continue;
      deleted += Number(await client.del(batch));
    }

    return deleted;
  }

  private uniqueSorted(values: string[]): string[] {
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
  }

  private ipCandidates(ip: string): string[] {
    const out = new Set<string>();
    const normalized = ip.trim().toLowerCase();

    if (net.isIP(normalized) === 4) {
      out.add(normalized);
      out.add(`::ffff:${normalized}`);
      return Array.from(out);
    }

    if (net.isIP(normalized) === 6) {
      out.add(normalized);
      const mappedIpv4 = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)?.[1];
      if (mappedIpv4 && net.isIP(mappedIpv4) === 4) {
        out.add(mappedIpv4);
      }
    }

    return Array.from(out);
  }
}
