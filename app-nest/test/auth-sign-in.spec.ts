import crypto from "node:crypto";
import { jest } from "@jest/globals";

import { AuthController } from "../src/modules/auth/auth.controller.js";
import {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
} from "../src/shared/utils/auth-cookies.js";
import { createMockRequest, createMockResponse } from "./http-mocks.js";

type AuthUserRow = {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  email_verified_at: string | null;
  is_active: number;
  is_admin: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
};

function createController() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const authSettings = {
    verifyEmailTtlMinutes: 30,
    passwordResetTtlMinutes: 15,
    refreshTtlDays: 30,
    maxActiveSessionFamilies: 5,
    cookieSameSite: "lax",
    csrfSecret: "csrf-secret",
    jwtAccessPrivateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    jwtAccessKid: "kid-1",
    jwtAccessVerificationKeys: {
      "kid-1": publicKey.export({ type: "spki", format: "pem" }).toString(),
    },
    jwtAccessIssuer: "mail-forwarding-api",
    jwtAccessAudience: "mail-forwarding-ui",
    jwtAccessTtlSeconds: 600,
    jwtAccessClockSkewSeconds: 60,
  };
  const appSettings = { envName: "prod" };

  const configService = {
    getOrThrow: jest.fn((key: string) => {
      if (key === "auth") return authSettings;
      if (key === "app") return appSettings;
      throw new Error(`unexpected config key: ${key}`);
    }),
  };
  const getActiveUserByIdentifier = jest
    .fn<(identifier: { type: string; value: string }) => Promise<AuthUserRow | null>>();
  const createSessionFamilyTx = jest.fn<
    (payload: Record<string, unknown>) => Promise<{
      ok: boolean;
      sessionId: number | null;
      sessionFamilyId: string;
      refreshExpiresAt: string | null;
      evictedFamilyIds: string[];
    }>
  >();
  const updateLastLoginAtById = jest.fn<(userId: number) => Promise<boolean>>();
  const getUserById = jest.fn<(userId: number) => Promise<AuthUserRow | null>>();
  const authUsersRepository = {
    getActiveUserByIdentifier,
    createSessionFamilyTx,
    updateLastLoginAtById,
    getUserById,
  };
  const emailVerificationTokensRepository = {};
  const passwordResetRequestsRepository = {};
  const authSessionContextService = {};
  const emailVerificationEmailService = {};
  const passwordResetEmailService = {};
  const consumeSlowVerify = jest.fn<(rawPassword: unknown) => Promise<void>>();
  const verifyPassword = jest.fn<
    (storedHash: string, password: string) => Promise<boolean>
  >();
  const hashPassword = jest.fn<(password: string) => Promise<string>>();
  const passwordService = {
    consumeSlowVerify,
    verifyPassword,
    hashPassword,
  };
  const logger = { logError: jest.fn(), warn: jest.fn() };

  return {
    controller: new AuthController(
      configService as never,
      authUsersRepository as never,
      emailVerificationTokensRepository as never,
      passwordResetRequestsRepository as never,
      authSessionContextService as never,
      emailVerificationEmailService as never,
      passwordResetEmailService as never,
      passwordService as never,
      logger as never,
    ),
    authUsersRepository,
    passwordService,
  };
}

function makeUser(overrides: Partial<AuthUserRow> = {}): AuthUserRow {
  return {
    id: 7,
    username: "alice",
    email: "alice@example.com",
    password_hash: "$argon2id$hash",
    email_verified_at: "2026-03-21T00:00:00.000Z",
    is_active: 1,
    is_admin: 0,
    created_at: "2026-03-20T00:00:00.000Z",
    updated_at: "2026-03-21T00:00:00.000Z",
    last_login_at: null,
    ...overrides,
  };
}

describe("AuthController sign-in", () => {
  it("runs the slow canary verification path when the user does not exist", async () => {
    const { controller, authUsersRepository, passwordService } = createController();
    authUsersRepository.getActiveUserByIdentifier.mockResolvedValue(null);
    passwordService.consumeSlowVerify.mockResolvedValue(undefined);

    const req = createMockRequest({
      method: "POST",
      path: "/auth/sign-in",
      body: {
        identifier: "missing@example.com",
        password: "CorrectHorseBatteryStaple1",
      },
    });
    const res = createMockResponse();

    await controller.signIn(req, res);

    expect(authUsersRepository.getActiveUserByIdentifier).toHaveBeenCalledWith({
      type: "email",
      value: "missing@example.com",
    });
    expect(passwordService.consumeSlowVerify).toHaveBeenCalledWith(
      "CorrectHorseBatteryStaple1",
    );
    expect(passwordService.verifyPassword).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: "auth_failed" });
  });

  it("creates a session and auth cookies on successful sign-in", async () => {
    const { controller, authUsersRepository, passwordService } = createController();
    const user = makeUser();
    const freshUser = makeUser({
      last_login_at: "2026-03-21T12:00:00.000Z",
    });

    authUsersRepository.getActiveUserByIdentifier.mockResolvedValue(user);
    passwordService.verifyPassword.mockResolvedValue(true);
    authUsersRepository.createSessionFamilyTx.mockResolvedValue({
      ok: true,
      sessionId: 100,
      sessionFamilyId: "family-123",
      refreshExpiresAt: "2026-04-20T00:00:00.000Z",
      evictedFamilyIds: [],
    });
    authUsersRepository.updateLastLoginAtById.mockResolvedValue(true);
    authUsersRepository.getUserById.mockResolvedValue(freshUser);

    const req = createMockRequest({
      method: "POST",
      path: "/auth/sign-in",
      ip: "203.0.113.10",
      headers: { "user-agent": "Jest Browser" },
      body: {
        identifier: "Alice@Example.com",
        password: "CorrectHorseBatteryStaple1",
      },
    });
    const res = createMockResponse();

    await controller.signIn(req, res);

    expect(passwordService.consumeSlowVerify).not.toHaveBeenCalled();
    expect(passwordService.verifyPassword).toHaveBeenCalledWith(
      user.password_hash,
      "CorrectHorseBatteryStaple1",
    );
    expect(authUsersRepository.createSessionFamilyTx).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: user.id,
        refreshTtlDays: 30,
      }),
    );
    expect(authUsersRepository.updateLastLoginAtById).toHaveBeenCalledWith(user.id);
    expect(res.statusCode).toBe(200);
    expect(res.cookies).toHaveLength(2);
    expect(res.cookies.map((cookie) => cookie.name)).toEqual([
      ACCESS_COOKIE_NAME,
      REFRESH_COOKIE_NAME,
    ]);
    expect(res.cookies[0]?.options.secure).toBe(true);
    expect(res.body).toEqual(
      expect.objectContaining({
        ok: true,
        action: "sign_in",
        authenticated: true,
        user: expect.objectContaining({
          id: user.id,
          email: user.email,
        }),
        session: expect.objectContaining({
          session_family_id: "family-123",
          refresh_expires_at: "2026-04-20T00:00:00.000Z",
        }),
      }),
    );
  });
});
