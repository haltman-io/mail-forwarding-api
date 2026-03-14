const request = require("supertest");

jest.mock("../../src/lib/ban-policy", () => ({
  domainSuffixes: jest.fn((domain) => [String(domain || "")]),
  ipCandidates: jest.fn((ip) => [String(ip || "")]),
  findActiveIpBan: jest.fn().mockResolvedValue(null),
  findActiveDomainBan: jest.fn().mockResolvedValue(null),
  findActiveEmailOrDomainBan: jest.fn().mockResolvedValue(null),
  findActiveNameBan: jest.fn().mockResolvedValue(null),
}));

const { app } = require("../../src/app");
const { findActiveIpBan } = require("../../src/lib/ban-policy");

describe("routes", () => {
  test("global middleware blocks banned IP before route handlers", async () => {
    findActiveIpBan.mockResolvedValueOnce({
      ban_type: "ip",
      ban_value: "::ffff:127.0.0.1",
      reason: "abuse",
      banned_at: "2026-02-23T00:00:00.000Z",
    });

    const res = await request(app).get("/domains");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: "banned",
      ban: {
        ban_type: "ip",
        ban_value: "::ffff:127.0.0.1",
        reason: "abuse",
        banned_at: "2026-02-23T00:00:00.000Z",
      },
    });
  });

  test("GET /forward/subscribe without params returns invalid_params", async () => {
    const res = await request(app).get("/forward/subscribe");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_params", field: "to" });
  });

  test("GET /forward/confirm with invalid token returns invalid_token", async () => {
    const res = await request(app).get("/forward/confirm?token=!!!");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error: "invalid_token" });
  });

  test("GET /api/credentials/confirm with invalid token returns invalid_token", async () => {
    const res = await request(app).get("/api/credentials/confirm?token=!!!");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_token" });
  });

  test("GET /api/alias/list without api key returns missing_api_key", async () => {
    const res = await request(app).get("/api/alias/list");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "missing_api_key" });
  });

  test("GET /api/alias/stats without api key returns missing_api_key", async () => {
    const res = await request(app).get("/api/alias/stats");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "missing_api_key" });
  });

  test("GET /api/activity without api key returns missing_api_key", async () => {
    const res = await request(app).get("/api/activity");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "missing_api_key" });
  });

  test("POST /auth/sign-in without params returns invalid_params(identifier)", async () => {
    const res = await request(app).post("/auth/sign-in").send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_params", field: "identifier" });
  });

  test("POST /auth/sign-up without params returns invalid_params(email)", async () => {
    const res = await request(app).post("/auth/sign-up").send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_params", field: "email" });
  });

  test("POST /auth/verify-email with invalid token returns invalid_token", async () => {
    const res = await request(app).post("/auth/verify-email").send({ token: "bad" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_token" });
  });

  test("GET /auth/session without auth cookie returns invalid_or_expired_session", async () => {
    const res = await request(app).get("/auth/session");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "invalid_or_expired_session" });
  });

  test("GET /auth/csrf without auth cookie returns invalid_or_expired_session", async () => {
    const res = await request(app).get("/auth/csrf");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "invalid_or_expired_session" });
  });

  test("POST /auth/forgot-password without params returns invalid_params(email)", async () => {
    const res = await request(app).post("/auth/forgot-password").send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_params", field: "email" });
  });

  test("POST /auth/reset-password without token returns invalid_params(token)", async () => {
    const res = await request(app).post("/auth/reset-password").send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_params", field: "token" });
  });

  test("POST /auth/reset-password with invalid token returns invalid_token", async () => {
    const res = await request(app)
      .post("/auth/reset-password")
      .send({ token: "bad", new_password: "StrongPassword123" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_token" });
  });

  test("POST /auth/sign-out without cookies is idempotent success", async () => {
    const res = await request(app).post("/auth/sign-out");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      action: "sign_out",
      signed_out: true,
    });
  });

  test("legacy /auth/login route is removed", async () => {
    const res = await request(app).post("/auth/login").send({});
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
  });

  test("GET /admin/domains without auth cookie returns invalid_or_expired_session", async () => {
    const res = await request(app).get("/admin/domains");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "invalid_or_expired_session" });
  });

  test("GET /admin/me without auth cookie returns invalid_or_expired_session", async () => {
    const res = await request(app).get("/admin/me");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "invalid_or_expired_session" });
  });

  test("GET /admin/handles without auth cookie returns invalid_or_expired_session", async () => {
    const res = await request(app).get("/admin/handles");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "invalid_or_expired_session" });
  });

  test("GET /admin/users without auth cookie returns invalid_or_expired_session", async () => {
    const res = await request(app).get("/admin/users");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "invalid_or_expired_session" });
  });

  test("PATCH /admin/users/me/password without auth cookie returns invalid_or_expired_session", async () => {
    const res = await request(app).patch("/admin/users/me/password").send({});
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "invalid_or_expired_session" });
  });
});
