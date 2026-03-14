jest.mock("../../src/config", () => ({
  config: {
    authRegisterTtlMinutes: 15,
    adminAuthTokenBytes: 32,
    adminAuthSessionTtlMinutes: 720,
    adminAuthDummyPasswordHash: "",
    adminLoginEmailEnabled: true,
  },
}));

jest.mock("../../src/repositories/admin-auth-repository", () => ({
  adminAuthRepository: {
    getUserByEmail: jest.fn(),
    getUserById: jest.fn(),
    getActiveUserByEmail: jest.fn(),
    createUser: jest.fn(),
    createSession: jest.fn(),
    updateLastLoginAtById: jest.fn(),
  },
}));

jest.mock("../../src/services/admin-password-service", () => ({
  hashAdminPassword: jest.fn(),
  verifyAdminPassword: jest.fn(),
  MIN_PASSWORD_LEN: 8,
  MAX_PASSWORD_LEN: 128,
}));

jest.mock("../../src/repositories/auth-register-requests-repository", () => ({
  authRegisterRequestsRepository: {
    consumePendingAndCreateUserTx: jest.fn(),
  },
}));

jest.mock("../../src/services/auth-register-email-service", () => ({
  sendAuthRegisterEmail: jest.fn(),
}));

jest.mock("../../src/services/admin-login-email-service", () => ({
  sendAdminLoginNotificationEmail: jest.fn(),
}));

jest.mock("../../src/lib/logger", () => ({
  logError: jest.fn(),
}));

const {
  registerUser,
  confirmRegistration,
  login,
} = require("../../src/controllers/auth/auth-controller");
const { adminAuthRepository } = require("../../src/repositories/admin-auth-repository");
const {
  authRegisterRequestsRepository,
} = require("../../src/repositories/auth-register-requests-repository");
const {
  hashAdminPassword,
  verifyAdminPassword,
} = require("../../src/services/admin-password-service");
const { sendAuthRegisterEmail } = require("../../src/services/auth-register-email-service");
const { sendAdminLoginNotificationEmail } = require("../../src/services/admin-login-email-service");

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
  };
}

describe("auth controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("register queues email verification for a common user account", async () => {
    adminAuthRepository.getUserByEmail.mockResolvedValue(null);
    hashAdminPassword.mockResolvedValue("hash");
    sendAuthRegisterEmail.mockResolvedValue({
      ok: true,
      sent: true,
      ttl_minutes: 15,
    });

    const req = {
      body: {
        email: "user@example.com",
        password: "StrongPassword123",
        is_admin: 1,
      },
      headers: {
        "user-agent": "unit-test-agent",
      },
      get: jest.fn((name) => {
        if (name === "origin") return "https://app.example.com";
        if (name === "referer") return "https://app.example.com/register";
        if (name === "referrer") return "";
        return "";
      }),
      ip: "198.51.100.20",
    };
    const res = createRes();

    await registerUser(req, res);

    expect(sendAuthRegisterEmail).toHaveBeenCalledWith({
      email: "user@example.com",
      passwordHash: "hash",
      requestIpText: "198.51.100.20",
      userAgent: "unit-test-agent",
      requestOrigin: "https://app.example.com",
      requestReferer: "https://app.example.com/register",
    });
    expect(adminAuthRepository.createUser).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      action: "register",
      accepted: true,
      verification: {
        sent: true,
        ttl_minutes: 15,
      },
    });
  });

  test("confirm registration activates the account", async () => {
    authRegisterRequestsRepository.consumePendingAndCreateUserTx.mockResolvedValue({
      ok: true,
      user: {
        id: 5,
        email: "user@example.com",
        is_active: 1,
        is_admin: 0,
        created_at: "2026-03-13T10:00:00.000Z",
        updated_at: "2026-03-13T10:00:00.000Z",
        last_login_at: null,
      },
    });

    const req = {
      query: {
        token: "123456",
      },
      body: {},
    };
    const res = createRes();

    await confirmRegistration(req, res);

    expect(authRegisterRequestsRepository.consumePendingAndCreateUserTx).toHaveBeenCalledWith({
      tokenHash32: expect.any(Buffer),
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      action: "register_confirm",
      confirmed: true,
      created: true,
      login_required: true,
      user: {
        id: 5,
        email: "user@example.com",
        is_active: 1,
        is_admin: false,
        created_at: "2026-03-13T10:00:00.000Z",
        updated_at: "2026-03-13T10:00:00.000Z",
        last_login_at: null,
      },
    });
  });

  test("confirm registration rejects invalid token format", async () => {
    const req = {
      query: {
        token: "abc",
      },
      body: {},
    };
    const res = createRes();

    await confirmRegistration(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "invalid_token" });
  });

  test("login returns the admin flag for an admin account", async () => {
    adminAuthRepository.getActiveUserByEmail.mockResolvedValue({
      id: 7,
      email: "admin@example.com",
      password_hash: "hash",
      is_active: 1,
      is_admin: 1,
      created_at: "2026-03-13T10:00:00.000Z",
      updated_at: "2026-03-13T10:00:00.000Z",
      last_login_at: null,
    });
    verifyAdminPassword.mockResolvedValue(true);
    adminAuthRepository.createSession.mockResolvedValue({
      ok: true,
      insertId: 21,
      expiresAt: "2026-03-13T22:00:00.000Z",
    });
    adminAuthRepository.updateLastLoginAtById.mockResolvedValue(true);
    adminAuthRepository.getUserById.mockResolvedValue({
      id: 7,
      email: "admin@example.com",
      is_active: 1,
      is_admin: 1,
      created_at: "2026-03-13T10:00:00.000Z",
      updated_at: "2026-03-13T10:00:00.000Z",
      last_login_at: "2026-03-13T11:00:00.000Z",
    });

    const req = {
      body: {
        email: "admin@example.com",
        password: "StrongPassword123",
      },
      headers: {
        "user-agent": "unit-test-agent",
      },
      ip: undefined,
    };
    const res = createRes();

    await login(req, res);

    expect(sendAdminLoginNotificationEmail).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        action: "login",
        user: expect.objectContaining({
          email: "admin@example.com",
          is_admin: true,
        }),
      })
    );
  });
});
