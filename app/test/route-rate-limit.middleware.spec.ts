import { jest } from "@jest/globals";

import { RouteRateLimitMiddleware } from "../src/shared/security/rate-limit/route-rate-limit.middleware.js";
import { createMockRequest, createMockResponse } from "./http-mocks.js";

describe("RouteRateLimitMiddleware", () => {
  const token =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  function createMiddleware(overrides: Partial<{ globalPerMin: number }> = {}) {
    const configService = {
      getOrThrow: jest.fn().mockReturnValue({
        redisPrefix: "rl:",
        globalPerMin: overrides.globalPerMin ?? 100,
        subscribeSlowDelayAfter: 100,
        subscribeSlowDelayStepMs: 1,
        subscribePer10MinPerIp: 100,
        subscribePerHourPerTo: 100,
        subscribePerHourPerAlias: 100,
        confirmPer10MinPerIp: 100,
        confirmPer10MinPerToken: 1,
        unsubscribeSlowDelayAfter: 100,
        unsubscribeSlowDelayStepMs: 1,
        unsubscribePer10MinPerIp: 100,
        unsubscribePerHourPerAddress: 100,
        checkdnsPer10MinPerTarget: 100,
        requestUiPerMinPerIp: 100,
        requestUiPer10MinPerTarget: 100,
        requestEmailPer10MinPerIp: 100,
        requestEmailPerHourPerTarget: 100,
        credentialsCreatePerHourPerIp: 100,
        credentialsCreatePerHourPerEmail: 100,
        credentialsConfirmPer10MinPerIp: 100,
        credentialsConfirmPer10MinPerToken: 1,
        authPasswordResetRequestPerHourPerIp: 100,
        authPasswordResetRequestPerHourPerEmail: 100,
        authPasswordResetConfirmPer10MinPerIp: 100,
        authPasswordResetConfirmPer10MinPerToken: 100,
        authLoginFailPer15MinPerIp: 100,
        authLoginFailPerHourPerIdentifier: 100,
        authLoginFailPer6HoursPerIdentifierIp: 100,
        authLoginFailPer5MinPerIdentifierIp: 1,
        aliasListPerMinPerKey: 1,
        aliasCreatePerMinPerKey: 1,
        aliasDeletePerMinPerKey: 1,
      }),
    };
    const redisService = {
      isConfigured: jest.fn().mockReturnValue(false),
      getClient: jest.fn(),
    };
    const logger = {
      warn: jest.fn(),
      logError: jest.fn(),
    };

    return new RouteRateLimitMiddleware(
      configService as never,
      redisService as never,
      logger as never,
    );
  }

  it("limits confirmation attempts by token", async () => {
    const middleware = createMiddleware();
    const next = jest.fn();

    const firstReq = createMockRequest({
      method: "POST",
      path: "/api/credentials/confirm",
      body: { token },
    });
    const firstRes = createMockResponse();

    await middleware.use(firstReq, firstRes, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(firstRes.statusCode).toBe(200);

    const secondReq = createMockRequest({
      method: "POST",
      path: "/api/credentials/confirm",
      body: { token },
    });
    const secondRes = createMockResponse();
    const secondNext = jest.fn();

    await middleware.use(secondReq, secondRes, secondNext);

    expect(secondNext).not.toHaveBeenCalled();
    expect(secondRes.statusCode).toBe(429);
    expect(secondRes.body).toEqual({
      error: "rate_limited",
      where: "credentials_confirm",
      reason: "too_many_requests_token",
    });
  });

  it("limits forwarding confirm previews by token as well", async () => {
    const middleware = createMiddleware();
    const next = jest.fn();

    const firstReq = createMockRequest({
      method: "GET",
      path: "/api/forward/confirm",
      query: { token },
    });
    const firstRes = createMockResponse();

    await middleware.use(firstReq, firstRes, next);

    expect(next).toHaveBeenCalledTimes(1);

    const secondReq = createMockRequest({
      method: "GET",
      path: "/api/forward/confirm",
      query: { token },
    });
    const secondRes = createMockResponse();
    const secondNext = jest.fn();

    await middleware.use(secondReq, secondRes, secondNext);

    expect(secondNext).not.toHaveBeenCalled();
    expect(secondRes.statusCode).toBe(429);
    expect(secondRes.body).toEqual({
      error: "rate_limited",
      where: "confirm",
      reason: "too_many_requests_token",
    });
  });

  it("skips API-key rate limiting when the request has no valid API key header", async () => {
    const middleware = createMiddleware();

    const firstReq = createMockRequest({
      method: "GET",
      path: "/api/alias/list",
    });
    const firstRes = createMockResponse();
    const firstNext = jest.fn();

    await middleware.use(firstReq, firstRes, firstNext);

    const secondReq = createMockRequest({
      method: "GET",
      path: "/api/alias/list",
      headers: { "x-api-key": "bad-key" },
    });
    const secondRes = createMockResponse();
    const secondNext = jest.fn();

    await middleware.use(secondReq, secondRes, secondNext);

    expect(firstNext).toHaveBeenCalledTimes(1);
    expect(secondNext).toHaveBeenCalledTimes(1);
    expect(firstRes.statusCode).toBe(200);
    expect(secondRes.statusCode).toBe(200);
  });

  it("counts only failed sign-in attempts for auth login limits", async () => {
    const middleware = createMiddleware();
    const next = jest.fn();

    const firstReq = createMockRequest({
      method: "POST",
      path: "/api/auth/sign-in",
      ip: "203.0.113.10",
      body: {
        identifier: "alice@example.com",
        password: "CorrectHorseBatteryStaple1",
      },
    });
    const firstRes = createMockResponse();

    await middleware.use(firstReq, firstRes, next);
    firstRes.status(401);
    firstRes.emit("finish");

    expect(next).toHaveBeenCalledTimes(1);

    const secondReq = createMockRequest({
      method: "POST",
      path: "/api/auth/sign-in",
      ip: "203.0.113.10",
      body: {
        identifier: "alice@example.com",
        password: "CorrectHorseBatteryStaple1",
      },
    });
    const secondRes = createMockResponse();
    const secondNext = jest.fn();

    await middleware.use(secondReq, secondRes, secondNext);

    expect(secondNext).not.toHaveBeenCalled();
    expect(secondRes.statusCode).toBe(429);
    expect(secondRes.body).toEqual({
      error: "rate_limited",
      where: "auth_login",
      reason: "too_many_failed_attempts_identifier_ip",
    });
  });

  it("does not count successful sign-in attempts against failure-only limits", async () => {
    const middleware = createMiddleware();

    const firstReq = createMockRequest({
      method: "POST",
      path: "/api/auth/sign-in",
      ip: "203.0.113.20",
      body: {
        identifier: "alice@example.com",
        password: "CorrectHorseBatteryStaple1",
      },
    });
    const firstRes = createMockResponse();
    const firstNext = jest.fn();

    await middleware.use(firstReq, firstRes, firstNext);
    firstRes.status(200);
    firstRes.emit("finish");

    const secondReq = createMockRequest({
      method: "POST",
      path: "/api/auth/sign-in",
      ip: "203.0.113.20",
      body: {
        identifier: "alice@example.com",
        password: "CorrectHorseBatteryStaple1",
      },
    });
    const secondRes = createMockResponse();
    const secondNext = jest.fn();

    await middleware.use(secondReq, secondRes, secondNext);

    expect(firstNext).toHaveBeenCalledTimes(1);
    expect(secondNext).toHaveBeenCalledTimes(1);
    expect(secondRes.statusCode).toBe(200);
  });

  it("applies the global rate limit to admin routes", async () => {
    const middleware = createMiddleware({ globalPerMin: 1 });

    const firstReq = createMockRequest({
      method: "GET",
      path: "/api/admin/protected",
      ip: "203.0.113.90",
    });
    const firstRes = createMockResponse();
    const firstNext = jest.fn();

    await middleware.use(firstReq, firstRes, firstNext);

    const secondReq = createMockRequest({
      method: "GET",
      path: "/api/admin/protected",
      ip: "203.0.113.90",
    });
    const secondRes = createMockResponse();
    const secondNext = jest.fn();

    await middleware.use(secondReq, secondRes, secondNext);

    expect(firstNext).toHaveBeenCalledTimes(1);
    expect(secondNext).not.toHaveBeenCalled();
    expect(secondRes.statusCode).toBe(429);
    expect(secondRes.body).toBe("Too many requests, please try again later.");
  });
});
