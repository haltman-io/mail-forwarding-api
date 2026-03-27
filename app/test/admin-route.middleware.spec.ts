import { jest } from "@jest/globals";
import type { Request } from "express";

import { AdminRouteMiddleware } from "../src/modules/admin/admin-route.middleware.js";
import type { ResolvedAuthContext } from "../src/modules/auth/services/auth-session-context.service.js";
import { createMockRequest, createMockResponse } from "./http-mocks.js";

function makeAdminAuthContext(
  overrides: Partial<ResolvedAuthContext> = {},
): ResolvedAuthContext {
  return {
    session_id: 1,
    session_family_id: "family-123",
    user_id: 7,
    username: "admin",
    email: "admin@example.com",
    is_admin: 1,
    email_verified_at: "2026-03-20T00:00:00.000Z",
    refresh_expires_at: "2026-04-20T00:00:00.000Z",
    password_changed_at: "2026-03-20T00:00:00.000Z",
    access_claims: null,
    access_expires_at: "2026-03-26T12:00:00.000Z",
    ...overrides,
  };
}

describe("AdminRouteMiddleware", () => {
  it("returns 401 when the access session is missing or invalid", async () => {
    const authSessionContextService = {
      resolveAccessSession: jest.fn<(request: Request) => Promise<ResolvedAuthContext | null>>(),
    };
    const logger = { logError: jest.fn() };
    const middleware = new AdminRouteMiddleware(
      authSessionContextService as never,
      logger as never,
    );
    const request = createMockRequest({
      method: "GET",
      path: "/api/admin/protected",
    });
    const response = createMockResponse();
    const next = jest.fn();

    authSessionContextService.resolveAccessSession.mockResolvedValue(null);

    await middleware.use(request, response, next);

    expect(response.statusCode).toBe(401);
    expect(response.body).toEqual({ error: "invalid_or_expired_session" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when the authenticated user is not an admin", async () => {
    const authSessionContextService = {
      resolveAccessSession: jest.fn<(request: Request) => Promise<ResolvedAuthContext | null>>(),
    };
    const logger = { logError: jest.fn() };
    const middleware = new AdminRouteMiddleware(
      authSessionContextService as never,
      logger as never,
    );
    const request = createMockRequest({
      method: "GET",
      path: "/api/admin/protected",
    });
    const response = createMockResponse();
    const next = jest.fn();

    authSessionContextService.resolveAccessSession.mockResolvedValue(
      makeAdminAuthContext({ is_admin: 0 }),
    );

    await middleware.use(request, response, next);

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({ error: "forbidden" });
    expect(next).not.toHaveBeenCalled();
    expect(request.admin_auth).toBeUndefined();
  });

  it("allows admin users and attaches the resolved admin context to the request", async () => {
    const authSessionContextService = {
      resolveAccessSession: jest.fn<(request: Request) => Promise<ResolvedAuthContext | null>>(),
    };
    const logger = { logError: jest.fn() };
    const middleware = new AdminRouteMiddleware(
      authSessionContextService as never,
      logger as never,
    );
    const request = createMockRequest({
      method: "GET",
      path: "/api/admin/protected",
    });
    const response = createMockResponse();
    const next = jest.fn();
    const authContext = makeAdminAuthContext();

    authSessionContextService.resolveAccessSession.mockResolvedValue(authContext);

    await middleware.use(request, response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.body).toBeUndefined();
    expect(request.admin_auth).toEqual(authContext);
  });

  it("returns 500 and logs unexpected errors", async () => {
    const authSessionContextService = {
      resolveAccessSession: jest.fn<(request: Request) => Promise<ResolvedAuthContext | null>>(),
    };
    const logger = { logError: jest.fn() };
    const middleware = new AdminRouteMiddleware(
      authSessionContextService as never,
      logger as never,
    );
    const request = createMockRequest({
      method: "GET",
      path: "/api/admin/protected",
    });
    const response = createMockResponse();
    const next = jest.fn();
    const error = new Error("boom");

    authSessionContextService.resolveAccessSession.mockRejectedValue(error);

    await middleware.use(request, response, next);

    expect(response.statusCode).toBe(500);
    expect(response.body).toEqual({ error: "internal_error" });
    expect(next).not.toHaveBeenCalled();
    expect(logger.logError).toHaveBeenCalledWith("admin.auth.error", error, request);
  });
});
