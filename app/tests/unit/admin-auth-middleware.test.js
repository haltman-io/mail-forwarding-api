jest.mock("../../src/config", () => ({
  config: {
    adminAuthTokenBytes: 32,
  },
}));

jest.mock("../../src/repositories/admin-auth-repository", () => ({
  adminAuthRepository: {
    getActiveSessionByTokenHash: jest.fn(),
    touchSessionLastUsed: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock("../../src/lib/logger", () => ({
  logError: jest.fn(),
}));

const { requireAdminAuth } = require("../../src/middlewares/admin-auth");
const { adminAuthRepository } = require("../../src/repositories/admin-auth-repository");

function createReq(token) {
  return {
    header(name) {
      if (name === "Authorization") return token ? `Bearer ${token}` : "";
      return "";
    },
  };
}

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe("requireAdminAuth", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("rejects a valid authenticated non-admin user", async () => {
    adminAuthRepository.getActiveSessionByTokenHash.mockResolvedValue({
      session_id: 11,
      user_id: 7,
      email: "user@example.com",
      is_admin: 0,
      expires_at: "2026-03-13T12:00:00.000Z",
    });

    const req = createReq("a".repeat(64));
    const res = createRes();
    const next = jest.fn();

    await requireAdminAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "admin_required" });
    expect(next).not.toHaveBeenCalled();
  });
});
