function loadServiceWithDomainList({ activeNames = [], rejectWith = null } = {}) {
  const listActiveNames = jest.fn();

  if (rejectWith) {
    listActiveNames.mockRejectedValue(rejectWith);
  } else {
    listActiveNames.mockResolvedValue(activeNames);
  }

  jest.doMock("../../src/repositories/domain-repository", () => ({
    domainRepository: { listActiveNames },
  }));

  const service = require("../../src/services/email-confirmation-service");
  return { service, listActiveNames };
}

describe("email-confirmation-service base URL resolution", () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test("uses Origin when domain is active and reuses cache", async () => {
    const { service, listActiveNames } = loadServiceWithDomainList({
      activeNames: ["tenant.example.com"],
    });

    const baseA = await service.resolveConfirmBaseUrl({
      requestOrigin: "https://tenant.example.com",
      requestReferer: "https://ignored.example.com/app",
    });
    const baseB = await service.resolveConfirmBaseUrl({
      requestOrigin: "https://tenant.example.com",
    });

    expect(baseA).toBe("https://tenant.example.com");
    expect(baseB).toBe("https://tenant.example.com");
    expect(listActiveNames).toHaveBeenCalledTimes(1);
  });

  test("falls back to Referer when Origin is not allowed", async () => {
    const { service } = loadServiceWithDomainList({
      activeNames: ["tenant.example.com"],
    });

    const base = await service.resolveConfirmBaseUrl({
      requestOrigin: "https://unknown.example.com",
      requestReferer: "https://tenant.example.com/area/dashboard",
    });

    expect(base).toBe("https://tenant.example.com");
  });

  test("falls back to APP_PUBLIC_URL for invalid headers or repository errors", async () => {
    const first = loadServiceWithDomainList({
      activeNames: ["tenant.example.com"],
    });

    const invalidHeaderBase = await first.service.resolveConfirmBaseUrl({
      requestOrigin: "javascript:alert(1)",
    });

    expect(invalidHeaderBase).toBe("http://localhost:8080");
    expect(first.listActiveNames).not.toHaveBeenCalled();

    jest.resetModules();
    const second = loadServiceWithDomainList({
      rejectWith: new Error("db_unavailable"),
    });

    const dbErrorBase = await second.service.resolveConfirmBaseUrl({
      requestOrigin: "https://tenant.example.com",
    });

    expect(dbErrorBase).toBe("http://localhost:8080");
  });
});
