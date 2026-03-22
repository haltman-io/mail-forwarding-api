import { jest } from "@jest/globals";

import { AuthController } from "../src/modules/auth/auth.controller.js";
import { createMockRequest, createMockResponse } from "./http-mocks.js";

function createController() {
  const configService = {
    getOrThrow: jest.fn((key: string) => {
      if (key === "app") return { envName: "prod" };
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
  const getActiveUserByEmail = jest.fn<(email: string) => Promise<unknown | null>>();
  const authUsersRepository = {
    getActiveUserByEmail,
  };
  const emailVerificationTokensRepository = {};
  const getPendingByTokenHash = jest.fn<
    (tokenHash32: Buffer) => Promise<Record<string, unknown> | null>
  >();
  const consumePendingAndResetPasswordTx = jest.fn<
    (payload: Record<string, unknown>) => Promise<{
      ok: boolean;
      sessionsRevoked?: number;
      user?: Record<string, unknown> | null;
    }>
  >();
  const passwordResetRequestsRepository = {
    getPendingByTokenHash,
    consumePendingAndResetPasswordTx,
  };
  const authSessionContextService = {};
  const emailVerificationEmailService = {};
  const sendPasswordResetEmail = jest
    .fn<(payload: Record<string, unknown>) => Promise<void>>();
  const passwordResetEmailService = {
    sendPasswordResetEmail,
  };
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
    passwordResetRequestsRepository,
    passwordResetEmailService,
    passwordService,
  };
}

describe("AuthController recovery", () => {
  it("returns the same forgot-password response even when the account does not exist", async () => {
    const { controller, authUsersRepository, passwordResetEmailService } =
      createController();
    authUsersRepository.getActiveUserByEmail.mockResolvedValue(null);

    const req = createMockRequest({
      method: "POST",
      path: "/auth/forgot-password",
      body: { email: "missing@example.com" },
    });
    const res = createMockResponse();

    await controller.forgotPassword(req, res);

    expect(passwordResetEmailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      action: "forgot_password",
      accepted: true,
      recovery: {
        ttl_minutes: 15,
      },
    });
  });

  it("resets the password, revokes sessions, and clears auth cookies", async () => {
    const {
      controller,
      passwordResetRequestsRepository,
      passwordService,
    } = createController();
    passwordResetRequestsRepository.getPendingByTokenHash.mockResolvedValue({
      id: 1,
      user_id: 7,
    });
    passwordService.hashPassword.mockResolvedValue("$argon2id$newhash");
    passwordResetRequestsRepository.consumePendingAndResetPasswordTx.mockResolvedValue({
      ok: true,
      sessionsRevoked: 4,
      user: { id: 7, email: "alice@example.com" },
    });

    const req = createMockRequest({
      method: "POST",
      path: "/auth/reset-password",
      body: {
        token: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        new_password: "CorrectHorseBatteryStaple1",
      },
    });
    const res = createMockResponse();

    await controller.resetPassword(req, res);

    expect(passwordService.hashPassword).toHaveBeenCalledWith(
      "CorrectHorseBatteryStaple1",
    );
    expect(
      passwordResetRequestsRepository.consumePendingAndResetPasswordTx,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        passwordHash: "$argon2id$newhash",
      }),
    );
    expect(res.clearedCookies).toHaveLength(2);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      action: "reset_password",
      updated: true,
      reauth_required: true,
      sessions_revoked: 4,
      user: { id: 7, email: "alice@example.com" },
    });
  });
});
