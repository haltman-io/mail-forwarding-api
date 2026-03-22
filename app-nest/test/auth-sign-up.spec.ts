import { jest } from "@jest/globals";

import { AuthController } from "../src/modules/auth/auth.controller.js";
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
  const configService = {
    getOrThrow: jest.fn((key: string) => {
      if (key === "app") return { envName: "test" };
      if (key === "auth") {
        return {
          verifyEmailTtlMinutes: 30,
          passwordResetTtlMinutes: 15,
          refreshTtlDays: 30,
          maxActiveSessionFamilies: 5,
          cookieSameSite: "lax",
          csrfSecret: "csrf-secret",
          jwtAccessPrivateKey: "unused",
          jwtAccessKid: "unused",
          jwtAccessVerificationKeys: {},
          jwtAccessIssuer: "unused",
          jwtAccessAudience: "unused",
          jwtAccessTtlSeconds: 600,
          jwtAccessClockSkewSeconds: 60,
        };
      }
      throw new Error(`unexpected config key: ${key}`);
    }),
  };
  const getUserByEmail = jest.fn<(email: string) => Promise<AuthUserRow | null>>();
  const getUserByUsername = jest.fn<(username: string) => Promise<AuthUserRow | null>>();
  const createUser = jest.fn<
    (payload: Record<string, unknown>) => Promise<{ ok: boolean; insertId: number | null }>
  >();
  const authUsersRepository = {
    getUserByEmail,
    getUserByUsername,
    createUser,
  };
  const emailVerificationTokensRepository = {};
  const passwordResetRequestsRepository = {};
  const authSessionContextService = {};
  const sendEmailVerificationEmail = jest
    .fn<(payload: Record<string, unknown>) => Promise<void>>();
  const emailVerificationEmailService = {
    sendEmailVerificationEmail,
  };
  const passwordResetEmailService = {};
  const hashPassword = jest.fn<(password: string) => Promise<string>>();
  const consumeSlowVerify = jest.fn<(rawPassword: unknown) => Promise<void>>();
  const verifyPassword = jest.fn<
    (storedHash: string, password: string) => Promise<boolean>
  >();
  const passwordService = {
    hashPassword,
    consumeSlowVerify,
    verifyPassword,
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
    emailVerificationEmailService,
    passwordService,
  };
}

function makeUser(overrides: Partial<AuthUserRow> = {}): AuthUserRow {
  return {
    id: 11,
    username: "alice",
    email: "alice@example.com",
    password_hash: "$argon2id$hash",
    email_verified_at: null,
    is_active: 1,
    is_admin: 0,
    created_at: "2026-03-20T00:00:00.000Z",
    updated_at: "2026-03-21T00:00:00.000Z",
    last_login_at: null,
    ...overrides,
  };
}

describe("AuthController sign-up", () => {
  it("returns a generic accepted response for an existing email without leaking existence", async () => {
    const { controller, authUsersRepository, emailVerificationEmailService, passwordService } =
      createController();
    authUsersRepository.getUserByEmail.mockResolvedValue(makeUser());
    authUsersRepository.getUserByUsername.mockResolvedValue(null);

    const req = createMockRequest({
      method: "POST",
      path: "/auth/sign-up",
      body: {
        email: "Alice@Example.com",
        username: "alice",
        password: "CorrectHorseBatteryStaple1",
      },
    });
    const res = createMockResponse();

    await controller.signUp(req, res);

    expect(passwordService.hashPassword).not.toHaveBeenCalled();
    expect(authUsersRepository.createUser).not.toHaveBeenCalled();
    expect(emailVerificationEmailService.sendEmailVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 11,
        email: "alice@example.com",
      }),
    );
    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({
      ok: true,
      action: "sign_up",
      accepted: true,
    });
  });

  it("creates a new user with a hashed password and normalized identifiers", async () => {
    const { controller, authUsersRepository, emailVerificationEmailService, passwordService } =
      createController();
    authUsersRepository.getUserByEmail.mockResolvedValue(null);
    authUsersRepository.getUserByUsername.mockResolvedValue(null);
    passwordService.hashPassword.mockResolvedValue("$argon2id$newhash");
    authUsersRepository.createUser.mockResolvedValue({
      ok: true,
      insertId: 77,
    });

    const req = createMockRequest({
      method: "POST",
      path: "/auth/sign-up",
      headers: { "user-agent": "Jest Browser" },
      body: {
        email: "Alice@Example.com",
        username: "Alice_User",
        password: "CorrectHorseBatteryStaple1",
      },
    });
    const res = createMockResponse();

    await controller.signUp(req, res);

    expect(passwordService.hashPassword).toHaveBeenCalledWith(
      "CorrectHorseBatteryStaple1",
    );
    expect(authUsersRepository.createUser).toHaveBeenCalledWith({
      email: "alice@example.com",
      username: "alice_user",
      passwordHash: "$argon2id$newhash",
      isActive: 1,
      isAdmin: 0,
      emailVerifiedAt: null,
    });
    expect(emailVerificationEmailService.sendEmailVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 77,
        email: "alice@example.com",
      }),
    );
    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({
      ok: true,
      action: "sign_up",
      accepted: true,
    });
  });
});
