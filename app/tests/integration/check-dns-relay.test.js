const request = require("supertest");

const mockPost = jest.fn();
const mockGet = jest.fn();

jest.mock("axios", () => ({
  create: jest.fn(() => ({
    post: mockPost,
    get: mockGet,
  })),
}));

const { app } = require("../../src/app");

describe("check-dns relay routes", () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockGet.mockReset();
  });

  test("POST /request/ui without json content-type returns 415", async () => {
    const res = await request(app).post("/request/ui").send("target=example.com");
    expect(res.status).toBe(415);
    expect(res.body).toEqual({ error: "unsupported_media_type" });
    expect(mockPost).not.toHaveBeenCalled();
  });

  test("POST /request/ui with url-like target returns 400", async () => {
    const res = await request(app)
      .post("/request/ui")
      .set("Content-Type", "application/json")
      .send({ target: "https://example.com" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "target must be a domain name without scheme" });
    expect(mockPost).not.toHaveBeenCalled();
  });

  test("POST /request/ui passes through 202 response", async () => {
    mockPost.mockResolvedValue({
      status: 202,
      data: { id: 1, target: "example.com", status: "PENDING" },
    });

    const res = await request(app)
      .post("/request/ui")
      .set("Content-Type", "application/json")
      .send({ target: "Example.com." });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ id: 1, target: "example.com", status: "PENDING" });
    expect(mockPost).toHaveBeenCalledWith(
      "/request/ui",
      { target: "example.com" },
      { headers: { "x-api-key": "test-token", "content-type": "application/json" } }
    );
  });

  test("GET /api/checkdns/:target passes through 401 response", async () => {
    mockGet.mockResolvedValue({
      status: 401,
      data: { error: "unauthorized" },
    });

    const res = await request(app).get("/api/checkdns/example.com");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
    expect(mockGet).toHaveBeenCalledWith("/api/checkdns/example.com", {
      headers: { "x-api-key": "test-token" },
    });
  });

  test("POST /request/email passes through 409 response", async () => {
    mockPost.mockResolvedValue({
      status: 409,
      data: { error: "Duplicate request for EMAIL example.com" },
    });

    const res = await request(app)
      .post("/request/email")
      .set("Content-Type", "application/json")
      .send({ target: "example.com" });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "Duplicate request for EMAIL example.com" });
  });

  test("POST /request/email passes through 429 response", async () => {
    mockPost.mockResolvedValue({
      status: 429,
      data: { error: "rate_limited", message: "Too many requests" },
    });

    const res = await request(app)
      .post("/request/email")
      .set("Content-Type", "application/json")
      .send({ target: "example.com" });

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: "rate_limited", message: "Too many requests" });
  });
});
