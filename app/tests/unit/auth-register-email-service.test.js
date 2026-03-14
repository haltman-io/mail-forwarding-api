function loadAuthRegisterEmailService({
  upsertResult = { action: "created", token_plain: "123456", pending: null },
} = {}) {
  const upsertPendingByEmailTx = jest.fn().mockResolvedValue(upsertResult);
  const packIp16 = jest.fn((ip) => (ip ? `packed:${ip}` : null));
  const sendMail = jest.fn().mockResolvedValue({ ok: true });
  const createTransport = jest.fn(() => ({ sendMail }));
  const resolveConfirmBaseUrl = jest.fn().mockResolvedValue("http://localhost:8080");

  let service;
  jest.isolateModules(() => {
    jest.doMock("../../src/config", () => ({
      config: {
        appPublicUrl: "http://localhost:8080",
        authRegisterConfirmEndpoint: "/auth/register/confirm",
        authRegisterTtlMinutes: 15,
        authRegisterResendCooldownSeconds: 60,
        authRegisterMaxSends: 3,
        authRegisterEmailSubject: "Verify your email",
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        smtpSecure: false,
        smtpAuthEnabled: true,
        smtpUser: "smtp-user",
        smtpPass: "smtp-pass",
        smtpFrom: "Test <test@example.com>",
        smtpHeloName: "",
        smtpTlsRejectUnauthorized: true,
      },
    }));
    jest.doMock("nodemailer", () => ({ createTransport }));
    jest.doMock("../../src/repositories/auth-register-requests-repository", () => ({
      authRegisterRequestsRepository: { upsertPendingByEmailTx },
    }));
    jest.doMock("../../src/lib/ip-pack", () => ({ packIp16 }));
    jest.doMock("../../src/services/email-confirmation-service", () => ({
      resolveConfirmBaseUrl,
    }));

    service = require("../../src/services/auth-register-email-service");
  });

  return {
    service,
    upsertPendingByEmailTx,
    packIp16,
    sendMail,
    createTransport,
    resolveConfirmBaseUrl,
  };
}

afterEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

describe("auth-register-email-service", () => {
  test("sends email verification for pending account activation", async () => {
    const {
      service,
      upsertPendingByEmailTx,
      packIp16,
      sendMail,
      createTransport,
      resolveConfirmBaseUrl,
    } = loadAuthRegisterEmailService({
      upsertResult: {
        action: "created",
        token_plain: "654321",
        pending: {
          id: 9,
          send_count: 1,
        },
      },
    });

    const result = await service.sendAuthRegisterEmail({
      email: " User@example.com ",
      passwordHash: "argon-hash",
      requestIpText: "203.0.113.7",
      userAgent: "unit-test-agent",
      requestOrigin: "https://app.example.com",
      requestReferer: "https://app.example.com/register",
    });

    expect(packIp16).toHaveBeenCalledWith("203.0.113.7");
    expect(upsertPendingByEmailTx).toHaveBeenCalledWith({
      email: "user@example.com",
      passwordHash: "argon-hash",
      ttlMinutes: 15,
      cooldownSeconds: 60,
      maxSendCount: 3,
      requestIpPacked: "packed:203.0.113.7",
      userAgentOrNull: "unit-test-agent",
    });

    expect(resolveConfirmBaseUrl).toHaveBeenCalledWith({
      requestOrigin: "https://app.example.com",
      requestReferer: "https://app.example.com/register",
    });
    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(1);

    const mail = sendMail.mock.calls[0][0];
    expect(mail.from).toBe("Test <test@example.com>");
    expect(mail.to).toBe("user@example.com");
    expect(mail.subject).toBe("654321 is your verification code | localhost / Verify your email");
    expect(mail.text).toContain("YOUR VERIFICATION CODE IS: 654321");
    expect(mail.text).toContain("ACCOUNT REGISTRATION REQUEST DETECTED.");
    expect(mail.text).toContain("/auth/register/confirm?token=654321");
    expect(mail.html).toContain("Your verification code is:");
    expect(mail.html).toContain("activate your account");

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

    const { service, sendMail } = loadAuthRegisterEmailService({
      upsertResult: {
        action: "cooldown",
        pending,
      },
    });

    const result = await service.sendAuthRegisterEmail({
      email: "user@example.com",
      passwordHash: "argon-hash",
      requestIpText: "198.51.100.12",
      userAgent: "ua",
      requestOrigin: "https://app.example.com",
      requestReferer: "https://app.example.com/register",
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
});
