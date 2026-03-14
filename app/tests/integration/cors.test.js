const request = require("supertest");

describe("cors", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
    jest.clearAllMocks();
  });

  function loadApp({ activeDomains = [] } = {}) {
    jest.doMock("../../src/lib/ban-policy", () => ({
      domainSuffixes: jest.fn((domain) => [String(domain || "")]),
      ipCandidates: jest.fn((ip) => [String(ip || "")]),
      findActiveIpBan: jest.fn().mockResolvedValue(null),
      findActiveDomainBan: jest.fn().mockResolvedValue(null),
      findActiveEmailOrDomainBan: jest.fn().mockResolvedValue(null),
      findActiveNameBan: jest.fn().mockResolvedValue(null),
    }));

    jest.doMock("../../src/repositories/domain-repository", () => ({
      domainRepository: {
        listActiveNames: jest.fn().mockResolvedValue(activeDomains),
      },
    }));

    return require("../../src/app").app;
  }

  test("allows credentialed preflight for an active tenant domain from the database", async () => {
    process.env.CORS_ALLOWED_ORIGINS = "";
    process.env.CORS_ALLOW_CREDENTIALS = "true";

    const app = loadApp({ activeDomains: ["tenant.example"] });
    const res = await request(app)
      .options("/auth/sign-in")
      .set("Origin", "https://tenant.example")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type,x-csrf-token");

    expect(res.headers["access-control-allow-origin"]).toBe("https://tenant.example");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  test("allows configured static override origins", async () => {
    process.env.CORS_ALLOWED_ORIGINS = "http://localhost:3000";
    process.env.CORS_ALLOW_CREDENTIALS = "true";

    const app = loadApp({ activeDomains: [] });
    const res = await request(app)
      .options("/auth/sign-in")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type,x-csrf-token");

    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  test("does not allow unconfigured cross-origin requests", async () => {
    process.env.CORS_ALLOWED_ORIGINS = "http://localhost:3000";
    process.env.CORS_ALLOW_CREDENTIALS = "true";

    const app = loadApp({ activeDomains: ["tenant.example"] });
    const res = await request(app)
      .options("/auth/sign-in")
      .set("Origin", "http://evil.example")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type,x-csrf-token");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
  });
});
