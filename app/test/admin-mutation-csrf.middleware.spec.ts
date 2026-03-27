import { jest } from "@jest/globals";

import { AdminMutationCsrfMiddleware } from "../src/modules/admin/admin-mutation-csrf.middleware.js";
import { createMockRequest, createMockResponse } from "./http-mocks.js";

describe("AdminMutationCsrfMiddleware", () => {
  it("returns 403 when the csrf header is missing", () => {
    const configService = {
      getOrThrow: jest.fn().mockReturnValue({ csrfSecret: "csrf-secret" }),
    };
    const logger = { logError: jest.fn() };
    const middleware = new AdminMutationCsrfMiddleware(
      configService as never,
      logger as never,
    );
    const request = createMockRequest({
      method: "POST",
      path: "/api/admin/domains",
    });
    request.admin_auth = {
      session_id: 1,
      session_family_id: "family-123",
      user_id: 7,
      username: "admin",
      email: "admin@example.com",
      is_admin: 1,
      email_verified_at: null,
      refresh_expires_at: null,
      password_changed_at: null,
      access_claims: null,
      access_expires_at: null,
    };
    const response = createMockResponse();
    const next = jest.fn();

    middleware.use(request, response, next);

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({ error: "csrf_required" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when the csrf token is invalid", () => {
    const configService = {
      getOrThrow: jest.fn().mockReturnValue({ csrfSecret: "csrf-secret" }),
    };
    const logger = { logError: jest.fn() };
    const middleware = new AdminMutationCsrfMiddleware(
      configService as never,
      logger as never,
    );
    const request = createMockRequest({
      method: "PATCH",
      path: "/api/admin/users/1",
      headers: { "x-csrf-token": "bad-token" },
    });
    request.admin_auth = {
      session_id: 1,
      session_family_id: "family-123",
      user_id: 7,
      username: "admin",
      email: "admin@example.com",
      is_admin: 1,
      email_verified_at: null,
      refresh_expires_at: null,
      password_changed_at: null,
      access_claims: null,
      access_expires_at: null,
    };
    const response = createMockResponse();
    const next = jest.fn();

    middleware.use(request, response, next);

    expect(response.statusCode).toBe(403);
    expect(response.body).toEqual({ error: "invalid_csrf_token" });
    expect(next).not.toHaveBeenCalled();
  });
});
