import { jest } from "@jest/globals";

import { AdminRateLimitService } from "../src/modules/admin/rate-limit/admin-rate-limit.service.js";

async function* scanKeys(keys: string[]): AsyncGenerator<string[], void, unknown> {
  await Promise.resolve();
  yield keys;
}

function createService(keys: Record<string, { value: string; ttl: number }> = {}) {
  const configService = {
    getOrThrow: jest.fn().mockReturnValue({ redisPrefix: "rl:" }),
  };
  const redisClient = {
    scanIterator: jest.fn(() => scanKeys(Object.keys(keys))),
    pTTL: jest.fn((key: string) => Promise.resolve(keys[key]?.ttl ?? -2)),
    get: jest.fn((key: string) => Promise.resolve(keys[key]?.value ?? null)),
    del: jest.fn((input: string | string[]) => {
      const inputKeys = Array.isArray(input) ? input : [input];
      let deleted = 0;
      for (const key of inputKeys) {
        if (keys[key]) {
          delete keys[key];
          deleted += 1;
        }
      }
      return Promise.resolve(deleted);
    }),
  };
  const redisService = {
    isConfigured: jest.fn().mockReturnValue(true),
    getClient: jest.fn(() => Promise.resolve(redisClient)),
  };
  const logger = {
    warn: jest.fn(),
  };

  return {
    service: new AdminRateLimitService(
      configService as never,
      redisService as never,
      logger as never,
    ),
    redisClient,
    redisService,
    logger,
    keys,
  };
}

describe("AdminRateLimitService", () => {
  it("returns a no-op response when Redis is not configured", async () => {
    const { service, redisService } = createService({
      "rl:global:203.0.113.5": { value: "10", ttl: 5000 },
    });
    redisService.isConfigured.mockReturnValue(false);

    const result = await service.resetRateLimit({
      target: "203.0.113.5",
      type: "ip",
    });

    expect(result).toEqual({
      ok: true,
      target: "203.0.113.5",
      type: "ip",
      resolved_type: "ip",
      redis_configured: false,
      redis_available: false,
      reason: "redis_not_configured",
      deleted_keys_count: 0,
      cleared_rules: [],
    });
    expect(redisService.getClient).not.toHaveBeenCalled();
  });

  it("returns a no-op response when Redis cannot be reached", async () => {
    const { service, redisService, logger } = createService();
    redisService.getClient.mockRejectedValue(new Error("connect failed"));

    const result = await service.resetRateLimit({
      target: "203.0.113.5",
      type: "ip",
    });

    expect(result).toMatchObject({
      ok: true,
      target: "203.0.113.5",
      type: "ip",
      resolved_type: "ip",
      redis_configured: true,
      redis_available: false,
      reason: "redis_unavailable",
      deleted_keys_count: 0,
      cleared_rules: [],
    });
    expect(logger.warn).toHaveBeenCalledWith("admin.rate_limit.redis_unavailable", expect.any(Object));
  });

  it("resets IP counters by exact IP and mapped IPv4 buckets only", async () => {
    const { service, keys } = createService({
      "rl:global:203.0.113.5": { value: "2", ttl: 1000 },
      "rl:fwd_cycle_ip:::ffff:203.0.113.5": { value: "3", ttl: 2000 },
      "rl:auth_login_fail_fast_identifier_ip:auth_login_fast:user@example.com:203.0.113.5": {
        value: "4",
        ttl: 3000,
      },
      "rl:global:203.0.113.50": { value: "5", ttl: 4000 },
    });

    const result = await service.resetRateLimit({
      target: "203.0.113.5",
      type: "ip",
    });

    expect(result.deleted_keys_count).toBe(3);
    expect(result.cleared_rules).toEqual([
      "auth_login_fail_fast_identifier_ip",
      "fwd_cycle_ip",
      "global",
    ]);
    expect(Object.keys(keys)).toEqual(["rl:global:203.0.113.50"]);
  });

  it("resets email counters by exact email fields without substring matches", async () => {
    const { service, keys } = createService({
      "rl:sub_to:to:user@example.com": { value: "2", ttl: 1000 },
      "rl:handle_sub_to:handle_to:user@example.com": { value: "3", ttl: 2000 },
      "rl:auth_login_fail_heavy_identifier_ip:auth_login_heavy:user@example.com:203.0.113.5": {
        value: "4",
        ttl: 3000,
      },
      "rl:sub_to:to:otheruser@example.com": { value: "5", ttl: 4000 },
      "rl:req_email_target:req_email:example.com": { value: "6", ttl: 5000 },
    });

    const result = await service.resetRateLimit({
      target: "user@example.com",
      type: "email",
    });

    expect(result.deleted_keys_count).toBe(3);
    expect(result.cleared_rules).toEqual([
      "auth_login_fail_heavy_identifier_ip",
      "handle_sub_to",
      "sub_to",
    ]);
    expect(Object.keys(keys).sort()).toEqual([
      "rl:req_email_target:req_email:example.com",
      "rl:sub_to:to:otheruser@example.com",
    ]);
  });

  it("resets domain counters by domain fields and email domain equality", async () => {
    const { service, keys } = createService({
      "rl:checkdns_target:checkdns:example.com": { value: "1", ttl: 1000 },
      "rl:req_ui_target:req_ui:example.com": { value: "2", ttl: 2000 },
      "rl:sub_alias:alias:example.com:john": { value: "3", ttl: 3000 },
      "rl:sub_to:to:user@example.com": { value: "4", ttl: 4000 },
      "rl:req_ui_target:req_ui:notexample.com": { value: "5", ttl: 5000 },
      "rl:sub_to:to:user@notexample.com": { value: "6", ttl: 6000 },
    });

    const result = await service.resetRateLimit({
      target: "example.com",
      type: "domain",
    });

    expect(result.deleted_keys_count).toBe(4);
    expect(result.cleared_rules).toEqual([
      "checkdns_target",
      "req_ui_target",
      "sub_alias",
      "sub_to",
    ]);
    expect(Object.keys(keys).sort()).toEqual([
      "rl:req_ui_target:req_ui:notexample.com",
      "rl:sub_to:to:user@notexample.com",
    ]);
  });

  it("checks active Redis keys and returns remaining TTLs", async () => {
    const { service } = createService({
      "rl:handle_sub_handle:handle_sub:john": { value: "2", ttl: 1200 },
      "rl:handle_domain_handle:handle_domain:john": { value: "3", ttl: 3400 },
      "rl:handle_sub_handle:handle_sub:johnny": { value: "4", ttl: 5600 },
    });

    const result = await service.checkRateLimit({
      target: "john",
      type: "auto",
    });

    expect(result).toMatchObject({
      ok: true,
      target: "john",
      type: "auto",
      resolved_type: "handle",
      redis_configured: true,
      redis_available: true,
      active_keys_count: 2,
    });
    expect(result.items).toEqual([
      {
        key: "rl:handle_domain_handle:handle_domain:john",
        rule: "handle_domain_handle",
        count: 3,
        ttl_ms: 3400,
      },
      {
        key: "rl:handle_sub_handle:handle_sub:john",
        rule: "handle_sub_handle",
        count: 2,
        ttl_ms: 1200,
      },
    ]);
  });
});
