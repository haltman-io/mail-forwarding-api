jest.mock("../../src/config", () => ({
  config: {
    adminUserChangeEmailEnabled: true,
  },
}));

jest.mock("../../src/repositories/admin-auth-repository", () => ({
  adminAuthRepository: {
    getUserByEmail: jest.fn(),
    createUser: jest.fn(),
    getUserById: jest.fn(),
    updateUserById: jest.fn(),
    countUsers: jest.fn(),
    revokeSessionsByUserId: jest.fn(),
  },
}));

jest.mock("../../src/services/admin-password-service", () => ({
  hashAdminPassword: jest.fn(),
  verifyAdminPassword: jest.fn(),
  MIN_PASSWORD_LEN: 8,
  MAX_PASSWORD_LEN: 128,
}));

jest.mock("../../src/services/admin-user-change-email-service", () => ({
  sendAdminUserChangeNotificationEmail: jest.fn(),
  sendAdminUserWelcomeEmail: jest.fn(),
}));

jest.mock("../../src/lib/logger", () => ({
  logError: jest.fn(),
}));

const {
  createAdminUser,
  updateAdminUser,
} = require("../../src/controllers/admin/users-controller");
const { adminAuthRepository } = require("../../src/repositories/admin-auth-repository");
const { hashAdminPassword } = require("../../src/services/admin-password-service");
const {
  sendAdminUserChangeNotificationEmail,
  sendAdminUserWelcomeEmail,
} = require("../../src/services/admin-user-change-email-service");

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
  };
}

describe("admin users controller notifications", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("create sends welcome email to the new admin", async () => {
    adminAuthRepository.getUserByEmail.mockResolvedValue(null);
    hashAdminPassword.mockResolvedValue("hash");
    adminAuthRepository.createUser.mockResolvedValue({ insertId: 7 });
    adminAuthRepository.getUserById.mockResolvedValue({
      id: 7,
      email: "new-admin@example.com",
      is_active: 1,
      created_at: "2026-02-23T18:00:00.000Z",
      updated_at: "2026-02-23T18:00:00.000Z",
      last_login_at: null,
    });

    const req = {
      body: {
        email: "new-admin@example.com",
        password: "StrongPassword123",
        is_active: 1,
      },
      admin_auth: {
        email: "creator@example.com",
      },
      ip: "198.51.100.10",
      headers: {
        "user-agent": "unit-test-agent",
      },
    };
    const res = createRes();

    await createAdminUser(req, res);

    expect(sendAdminUserWelcomeEmail).toHaveBeenCalledTimes(1);
    expect(sendAdminUserWelcomeEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        toEmail: "new-admin@example.com",
        targetEmail: "new-admin@example.com",
        actorEmail: "creator@example.com",
      })
    );
    expect(sendAdminUserChangeNotificationEmail).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test("update keeps technical change email notification", async () => {
    adminAuthRepository.getUserById
      .mockResolvedValueOnce({
        id: 7,
        email: "old-admin@example.com",
        is_active: 1,
        created_at: "2026-02-23T18:00:00.000Z",
        updated_at: "2026-02-23T18:00:00.000Z",
        last_login_at: null,
      })
      .mockResolvedValueOnce({
        id: 7,
        email: "updated-admin@example.com",
        is_active: 1,
        created_at: "2026-02-23T18:00:00.000Z",
        updated_at: "2026-02-23T18:10:00.000Z",
        last_login_at: null,
      });
    adminAuthRepository.getUserByEmail.mockResolvedValue(null);
    adminAuthRepository.updateUserById.mockResolvedValue(true);

    const req = {
      params: { id: "7" },
      body: { email: "updated-admin@example.com" },
      admin_auth: {
        email: "creator@example.com",
        user_id: 1,
      },
      ip: "198.51.100.10",
      headers: {
        "user-agent": "unit-test-agent",
      },
    };
    const res = createRes();

    await updateAdminUser(req, res);

    expect(sendAdminUserChangeNotificationEmail).toHaveBeenCalled();
    expect(sendAdminUserWelcomeEmail).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

