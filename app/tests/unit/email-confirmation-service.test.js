function loadEmailConfirmationServiceWithDomainList({ activeNames = [], rejectWith = null } = {}) {
  const listActiveNames = jest.fn();

  if (rejectWith) {
    listActiveNames.mockRejectedValue(rejectWith);
  } else {
    listActiveNames.mockResolvedValue(activeNames);
  }

  let service;
  jest.isolateModules(() => {
    jest.doMock("../../src/repositories/domain-repository", () => ({
      domainRepository: { listActiveNames },
    }));

    service = require("../../src/services/email-confirmation-service");
  });

  return { service, listActiveNames };
}

function loadApiCredentialsEmailService({
  upsertResult = { action: "created", token_plain: "123456", pending: null },
} = {}) {
  const upsertPendingByEmailTx = jest.fn().mockResolvedValue(upsertResult);
  const packIp16 = jest.fn((ip) => (ip ? `packed:${ip}` : null));
  const sendMail = jest.fn().mockResolvedValue({ ok: true });
  const createTransport = jest.fn(() => ({ sendMail }));

  let service;
  jest.isolateModules(() => {
    jest.doMock("nodemailer", () => ({ createTransport }));
    jest.doMock("../../src/repositories/api-token-requests-repository", () => ({
      apiTokenRequestsRepository: { upsertPendingByEmailTx },
    }));
    jest.doMock("../../src/lib/ip-pack", () => ({ packIp16 }));

    service = require("../../src/services/api-credentials-email-service");
  });

  return { service, upsertPendingByEmailTx, packIp16, sendMail, createTransport };
}

afterEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

describe("email-confirmation-service base URL resolution", () => {
  test("uses Origin when domain is active and reuses cache", async () => {
    const { service, listActiveNames } = loadEmailConfirmationServiceWithDomainList({
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
    const { service } = loadEmailConfirmationServiceWithDomainList({
      activeNames: ["tenant.example.com"],
    });

    const base = await service.resolveConfirmBaseUrl({
      requestOrigin: "https://unknown.example.com",
      requestReferer: "https://tenant.example.com/area/dashboard",
    });

    expect(base).toBe("https://tenant.example.com");
  });

  test("falls back to APP_PUBLIC_URL for invalid headers or repository errors", async () => {
    const first = loadEmailConfirmationServiceWithDomainList({
      activeNames: ["tenant.example.com"],
    });

    const invalidHeaderBase = await first.service.resolveConfirmBaseUrl({
      requestOrigin: "javascript:alert(1)",
    });

    expect(invalidHeaderBase).toBe("http://localhost:8080");
    expect(first.listActiveNames).not.toHaveBeenCalled();

    const second = loadEmailConfirmationServiceWithDomainList({
      rejectWith: new Error("db_unavailable"),
    });

    const dbErrorBase = await second.service.resolveConfirmBaseUrl({
      requestOrigin: "https://tenant.example.com",
    });

    expect(dbErrorBase).toBe("http://localhost:8080");
  });
});

describe("api-credentials-email-service", () => {
  test("sends API key confirmation with same visual pattern and explicit API-key semantics", async () => {
    const { service, upsertPendingByEmailTx, packIp16, sendMail, createTransport } =
      loadApiCredentialsEmailService({
        upsertResult: {
          action: "created",
          token_plain: "654321",
          pending: {
            id: 99,
            send_count: 1,
          },
        },
      });

    const result = await service.sendApiTokenRequestEmail({
      email: " User@example.com ",
      days: 30,
      requestIpText: "203.0.113.7",
      userAgent: "unit-test-agent",
    });

    expect(packIp16).toHaveBeenCalledWith("203.0.113.7");
    expect(upsertPendingByEmailTx).toHaveBeenCalledWith({
      email: "user@example.com",
      days: 30,
      ttlMinutes: 15,
      cooldownSeconds: 60,
      maxSendCount: 3,
      requestIpPacked: "packed:203.0.113.7",
      userAgentOrNull: "unit-test-agent",
    });

    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(1);

    const mail = sendMail.mock.calls[0][0];
    expect(mail.from).toBe("Test <test@example.com>");
    expect(mail.to).toBe("user@example.com");
    expect(mail.subject).toContain("CODE: 654321");
    expect(mail.text).toContain("API CREDENTIALS REQUEST DETECTED.");
    expect(mail.text).toContain("CREATE API KEY");
    expect(mail.html).toContain("PENDING CONFIRMATION");
    expect(mail.html).toContain("CREATE API KEY");
    expect(mail.html).toContain("Requested Email");
    expect(mail.html).toContain("API Key Lifetime");
    expect(mail.html).toContain("CONFIRMATION IS REQUIRED TO CREATE A NEW API KEY:");
    expect(mail.html).toContain("/api/credentials/confirm?token=654321");

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        sent: true,
        to: "user@example.com",
        ttl_minutes: 15,
        action: "created",
      })
    );
  });

  test("returns cooldown without sending email", async () => {
    const pending = {
      id: 1,
      send_count: 2,
      remaining_attempts: 1,
    };

    const { service, sendMail } = loadApiCredentialsEmailService({
      upsertResult: {
        action: "cooldown",
        pending,
      },
    });

    const result = await service.sendApiTokenRequestEmail({
      email: "user@example.com",
      days: 7,
      requestIpText: "198.51.100.12",
      userAgent: "ua",
    });

    expect(sendMail).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      sent: false,
      reason: "cooldown",
      ttl_minutes: 15,
      pending,
    });
  });

  test("throws when token_plain is missing for sendable actions", async () => {
    const { service, sendMail } = loadApiCredentialsEmailService({
      upsertResult: { action: "created" },
    });

    await expect(
      service.sendApiTokenRequestEmail({
        email: "user@example.com",
        days: 7,
        requestIpText: "198.51.100.42",
        userAgent: "ua",
      })
    ).rejects.toThrow("missing_token_plain");

    expect(sendMail).not.toHaveBeenCalled();
  });
});
