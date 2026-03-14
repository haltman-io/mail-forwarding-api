const request = require("supertest");

describe("cors", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  function loadApp() {
    jest.doMock("../../src/lib/ban-policy", () => ({
      domainSuffixes: jest.fn((domain) => [String(domain || "")]),
      ipCandidates: jest.fn((ip) => [String(ip || "")]),
      findActiveIpBan: jest.fn().mockResolvedValue(null),
      findActiveDomainBan: jest.fn().mockResolvedValue(null),
      findActiveEmailOrDomainBan: jest.fn().mockResolvedValue(null),
      findActiveNameBan: jest.fn().mockResolvedValue(null),
    }));

    return require("../../src/app").app;
  }

  test("reflects any origin for credentialed preflight", async () => {
    const app = loadApp();
    const res = await request(app)
      .options("/auth/sign-in")
      .set("Origin", "https://tenant.example")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type,x-csrf-token");

    expect(res.headers["access-control-allow-origin"]).toBe("https://tenant.example");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  test("also reflects arbitrary non-whitelisted origins", async () => {
    const app = loadApp();
    const res = await request(app)
      .options("/auth/sign-in")
      .set("Origin", "http://evil.example")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type,x-csrf-token");

    expect(res.headers["access-control-allow-origin"]).toBe("http://evil.example");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });
});
