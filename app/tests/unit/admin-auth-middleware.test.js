jest.mock("../../src/repositories/admin-auth-repository", () => ({
  adminAuthRepository: {
    touchSessionFamilyLastUsed: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock("../../src/lib/auth-session-context", () => ({
  resolveAccessSession: jest.fn(),
}));

jest.mock("../../src/lib/logger", () => ({
  logError: jest.fn(),
}));

const { requireAdminAuth } = require("../../src/middlewares/admin-auth");
const { resolveAccessSession } = require("../../src/lib/auth-session-context");

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
    resolveAccessSession.mockResolvedValue({
      session_id: 11,
      session_family_id: "family-123",
      user_id: 7,
      email: "user@example.com",
      is_admin: 0,
    });

    const req = {};
    const res = createRes();
    const next = jest.fn();

    await requireAdminAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "admin_required" });
    expect(next).not.toHaveBeenCalled();
  });
});
