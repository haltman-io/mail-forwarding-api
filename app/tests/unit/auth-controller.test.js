jest.mock("../../src/config", () => ({
  config: {
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

jest.mock("../../src/services/admin-login-email-service", () => ({
  sendAdminLoginNotificationEmail: jest.fn(),
}));

jest.mock("../../src/lib/logger", () => ({
  logError: jest.fn(),
}));

const { registerUser, login } = require("../../src/controllers/auth/auth-controller");
const { adminAuthRepository } = require("../../src/repositories/admin-auth-repository");
const {
  hashAdminPassword,
  verifyAdminPassword,
} = require("../../src/services/admin-password-service");
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

  test("register always creates a common user", async () => {
    adminAuthRepository.getUserByEmail.mockResolvedValue(null);
    hashAdminPassword.mockResolvedValue("hash");
    adminAuthRepository.createUser.mockResolvedValue({ insertId: 5 });
    adminAuthRepository.getUserById.mockResolvedValue({
      id: 5,
      email: "user@example.com",
      is_active: 1,
      is_admin: 0,
      created_at: "2026-03-13T10:00:00.000Z",
      updated_at: "2026-03-13T10:00:00.000Z",
      last_login_at: null,
    });

    const req = {
      body: {
        email: "user@example.com",
        password: "StrongPassword123",
        is_admin: 1,
      },
    };
    const res = createRes();

    await registerUser(req, res);

    expect(adminAuthRepository.createUser).toHaveBeenCalledWith({
      email: "user@example.com",
      passwordHash: "hash",
      isActive: 1,
      isAdmin: 0,
    });
    expect(res.status).toHaveBeenCalledWith(201);
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
