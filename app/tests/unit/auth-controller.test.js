jest.mock("../../src/config", () => ({
  config: {
    envName: "test",
    appEnv: "test",
    authRefreshTtlDays: 30,
    authMaxActiveSessionFamilies: 5,
    jwtAccessTtlSeconds: 600,
    adminAuthDummyPasswordHash: "",
    adminLoginEmailEnabled: true,
  },
}));

jest.mock("../../src/repositories/admin-auth-repository", () => ({
  adminAuthRepository: {
    getUserByEmail: jest.fn(),
    getUserByUsername: jest.fn(),
    createUser: jest.fn(),
    getUserById: jest.fn(),
    getActiveUserByIdentifier: jest.fn(),
    createSessionFamilyTx: jest.fn(),
    updateLastLoginAtById: jest.fn(),
  },
}));

jest.mock("../../src/repositories/email-verification-tokens-repository", () => ({
  emailVerificationTokensRepository: {
    consumePendingTokenTx: jest.fn(),
  },
}));

jest.mock("../../src/services/admin-password-service", () => ({
  hashAdminPassword: jest.fn(),
  verifyAdminPassword: jest.fn(),
  MIN_PASSWORD_LEN: 8,
  MAX_PASSWORD_LEN: 128,
}));

jest.mock("../../src/services/email-verification-email-service", () => ({
  sendEmailVerificationEmail: jest.fn(),
}));

jest.mock("../../src/services/admin-login-email-service", () => ({
  sendAdminLoginNotificationEmail: jest.fn(),
}));

jest.mock("../../src/lib/access-jwt", () => ({
  mintAccessJwt: jest.fn(),
}));

jest.mock("../../src/lib/logger", () => ({
  logError: jest.fn(),
}));

const {
  signUp,
  verifyEmail,
  signIn,
} = require("../../src/controllers/auth/auth-controller");
const { adminAuthRepository } = require("../../src/repositories/admin-auth-repository");
const {
  emailVerificationTokensRepository,
} = require("../../src/repositories/email-verification-tokens-repository");
const {
  hashAdminPassword,
  verifyAdminPassword,
} = require("../../src/services/admin-password-service");
const {
  sendEmailVerificationEmail,
} = require("../../src/services/email-verification-email-service");
const {
  sendAdminLoginNotificationEmail,
} = require("../../src/services/admin-login-email-service");
const { mintAccessJwt } = require("../../src/lib/access-jwt");

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    cookie: jest.fn().mockReturnThis(),
    clearCookie: jest.fn().mockReturnThis(),
  };
}

describe("auth controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mintAccessJwt.mockReturnValue({
      token: "access.jwt.token",
      claims: {
        exp: 1_800_000_000,
      },
    });
  });

  test("sign-up creates an unverified account and sends verification email", async () => {
    adminAuthRepository.getUserByEmail.mockResolvedValue(null);
    adminAuthRepository.getUserByUsername.mockResolvedValue(null);
    hashAdminPassword.mockResolvedValue("hash");
    adminAuthRepository.createUser.mockResolvedValue({ insertId: 5 });

    const req = {
      body: {
        email: "user@example.com",
        username: "new-user",
        password: "StrongPassword123",
      },
      headers: {
        "user-agent": "unit-test-agent",
      },
      ip: "198.51.100.20",
    };
    const res = createRes();

    await signUp(req, res);

    expect(hashAdminPassword).toHaveBeenCalledWith("StrongPassword123");
    expect(adminAuthRepository.createUser).toHaveBeenCalledWith({
      email: "user@example.com",
      username: "new-user",
      passwordHash: "hash",
      isActive: 1,
      isAdmin: 0,
      emailVerifiedAt: null,
    });
    expect(sendEmailVerificationEmail).toHaveBeenCalledWith({
      userId: 5,
      email: "user@example.com",
      requestIpText: "198.51.100.20",
      userAgent: "unit-test-agent",
    });
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      action: "sign_up",
      accepted: true,
    });
  });

  test("verify-email rejects invalid token format", async () => {
    const req = {
      body: {
        token: "bad",
      },
    };
    const res = createRes();

    await verifyEmail(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "invalid_token" });
  });

  test("sign-in issues auth cookies for a verified admin account", async () => {
    adminAuthRepository.getActiveUserByIdentifier.mockResolvedValue({
      id: 7,
      username: "admin",
      email: "admin@example.com",
      password_hash: "hash",
      email_verified_at: "2026-03-13T10:00:00.000Z",
      is_active: 1,
      is_admin: 1,
      created_at: "2026-03-13T10:00:00.000Z",
      updated_at: "2026-03-13T10:00:00.000Z",
      last_login_at: null,
    });
    verifyAdminPassword.mockResolvedValue(true);
    adminAuthRepository.createSessionFamilyTx.mockResolvedValue({
      ok: true,
      sessionId: 21,
      sessionFamilyId: "family-123",
      refreshExpiresAt: "2026-04-13T10:00:00.000Z",
      evictedFamilyIds: [],
    });
    adminAuthRepository.updateLastLoginAtById.mockResolvedValue(true);
    adminAuthRepository.getUserById.mockResolvedValue({
      id: 7,
      username: "admin",
      email: "admin@example.com",
      email_verified_at: "2026-03-13T10:00:00.000Z",
      is_active: 1,
      is_admin: 1,
      created_at: "2026-03-13T10:00:00.000Z",
      updated_at: "2026-03-13T10:00:00.000Z",
      last_login_at: "2026-03-13T11:00:00.000Z",
    });

    const req = {
      body: {
        identifier: "admin@example.com",
        password: "StrongPassword123",
      },
      headers: {
        "user-agent": "unit-test-agent",
      },
      ip: "198.51.100.20",
    };
    const res = createRes();

    await signIn(req, res);

    expect(sendAdminLoginNotificationEmail).toHaveBeenCalledTimes(1);
    expect(res.cookie).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        action: "sign_in",
        authenticated: true,
        user: expect.objectContaining({
          email: "admin@example.com",
          username: "admin",
          is_admin: true,
        }),
        session: expect.objectContaining({
          session_family_id: "family-123",
        }),
      })
    );
  });
});
