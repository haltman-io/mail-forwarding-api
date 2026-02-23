const request = require("supertest");
const { app } = require("../../src/app");

describe("routes", () => {
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

  test("POST /admin/login without params returns invalid_params(email)", async () => {
    const res = await request(app).post("/admin/login").send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_params", field: "email" });
  });

  test("GET /admin/domains without admin token returns missing_admin_token", async () => {
    const res = await request(app).get("/admin/domains");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "missing_admin_token" });
  });

  test("GET /admin/me without admin token returns missing_admin_token", async () => {
    const res = await request(app).get("/admin/me");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "missing_admin_token" });
  });

  test("GET /admin/users without admin token returns missing_admin_token", async () => {
    const res = await request(app).get("/admin/users");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "missing_admin_token" });
  });

  test("PATCH /admin/users/me/password without admin token returns missing_admin_token", async () => {
    const res = await request(app).patch("/admin/users/me/password").send({});
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "missing_admin_token" });
  });
});
