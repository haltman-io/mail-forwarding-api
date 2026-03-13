jest.mock("../../src/config", () => ({
  config: {
    passwordResetTtlMinutes: 15,
  },
}));

jest.mock("../../src/repositories/admin-auth-repository", () => ({
  adminAuthRepository: {
    getActiveUserByEmail: jest.fn(),
  },
}));

jest.mock("../../src/repositories/password-reset-requests-repository", () => ({
  passwordResetRequestsRepository: {
    getPendingByTokenHash: jest.fn(),
    consumePendingAndResetPasswordTx: jest.fn(),
  },
  sha256Buffer: jest.fn(() => Buffer.alloc(32, 1)),
}));

jest.mock("../../src/services/admin-password-service", () => ({
  hashAdminPassword: jest.fn(),
  MIN_PASSWORD_LEN: 8,
  MAX_PASSWORD_LEN: 128,
}));

jest.mock("../../src/services/password-reset-email-service", () => ({
  sendPasswordResetEmail: jest.fn(),
}));

jest.mock("../../src/lib/logger", () => ({
  logError: jest.fn(),
}));

const {
  requestPasswordReset,
  resetPassword,
} = require("../../src/controllers/auth/password-reset-controller");
const { adminAuthRepository } = require("../../src/repositories/admin-auth-repository");
const {
  passwordResetRequestsRepository,
} = require("../../src/repositories/password-reset-requests-repository");
const { hashAdminPassword } = require("../../src/services/admin-password-service");
const { sendPasswordResetEmail } = require("../../src/services/password-reset-email-service");

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
  };
}

describe("password reset controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("forgot password returns a generic accepted response when user is missing", async () => {
    adminAuthRepository.getActiveUserByEmail.mockResolvedValue(null);

    const req = {
      body: { email: "user@example.com" },
      headers: {},
      ip: "198.51.100.10",
    };
    const res = createRes();

    await requestPasswordReset(req, res);

    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      action: "password_reset_request",
      accepted: true,
      recovery: {
        ttl_minutes: 15,
      },
    });
  });

  test("forgot password still returns accepted when email delivery fails", async () => {
    adminAuthRepository.getActiveUserByEmail.mockResolvedValue({
      id: 7,
      email: "user@example.com",
    });
    sendPasswordResetEmail.mockRejectedValue(new Error("smtp_down"));

    const req = {
      body: { email: "user@example.com" },
      headers: {},
      ip: "198.51.100.10",
    };
    const res = createRes();

    await requestPasswordReset(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("reset password consumes token, changes password and revokes sessions", async () => {
    passwordResetRequestsRepository.getPendingByTokenHash.mockResolvedValue({
      id: 15,
      user_id: 7,
      email: "user@example.com",
    });
    hashAdminPassword.mockResolvedValue("new-hash");
    passwordResetRequestsRepository.consumePendingAndResetPasswordTx.mockResolvedValue({
      ok: true,
      user: {
        id: 7,
        email: "user@example.com",
      },
      sessionsRevoked: 3,
    });

    const req = {
      body: {
        token: "123456",
        new_password: "StrongPassword123",
      },
      query: {},
    };
    const res = createRes();

    await resetPassword(req, res);

    expect(hashAdminPassword).toHaveBeenCalledWith("StrongPassword123");
    expect(passwordResetRequestsRepository.consumePendingAndResetPasswordTx).toHaveBeenCalledWith({
      tokenHash32: expect.any(Buffer),
      passwordHash: "new-hash",
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      action: "password_reset",
      updated: true,
      reauth_required: true,
      sessions_revoked: 3,
      user: {
        id: 7,
        email: "user@example.com",
      },
    });
  });

  test("reset password rejects invalid token format", async () => {
    const req = {
      body: {
        token: "abc",
        new_password: "StrongPassword123",
      },
      query: {},
    };
    const res = createRes();

    await resetPassword(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "invalid_token" });
  });
});
