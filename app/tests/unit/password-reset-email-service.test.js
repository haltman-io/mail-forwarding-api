function loadPasswordResetEmailService({
  upsertResult = { action: "created", token_plain: "123456", pending: null },
} = {}) {
  const upsertPendingByUserIdTx = jest.fn().mockResolvedValue(upsertResult);
  const packIp16 = jest.fn((ip) => (ip ? `packed:${ip}` : null));
  const sendMail = jest.fn().mockResolvedValue({ ok: true });
  const createTransport = jest.fn(() => ({ sendMail }));

  let service;
  jest.isolateModules(() => {
    jest.doMock("nodemailer", () => ({ createTransport }));
    jest.doMock("../../src/repositories/password-reset-requests-repository", () => ({
      passwordResetRequestsRepository: { upsertPendingByUserIdTx },
    }));
    jest.doMock("../../src/lib/ip-pack", () => ({ packIp16 }));

    service = require("../../src/services/password-reset-email-service");
  });

  return { service, upsertPendingByUserIdTx, packIp16, sendMail, createTransport };
}

afterEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
});

describe("password-reset-email-service", () => {
  test("sends password reset email with a 15-minute one-time token", async () => {
    const { service, upsertPendingByUserIdTx, packIp16, sendMail, createTransport } =
      loadPasswordResetEmailService({
        upsertResult: {
          action: "created",
          token_plain: "654321",
          pending: {
            id: 42,
            send_count: 1,
          },
        },
      });

    const result = await service.sendPasswordResetEmail({
      userId: 7,
      email: " User@example.com ",
      requestIpText: "203.0.113.7",
      userAgent: "unit-test-agent",
    });

    expect(packIp16).toHaveBeenCalledWith("203.0.113.7");
    expect(upsertPendingByUserIdTx).toHaveBeenCalledWith({
      userId: 7,
      email: "user@example.com",
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
    expect(mail.subject).toBe("654321 is your verification code | localhost / Password reset");
    expect(mail.text).toContain("YOUR VERIFICATION CODE IS: 654321");
    expect(mail.text).toContain("PASSWORD RESET REQUEST DETECTED.");
    expect(mail.text).toContain("POST /auth/password/reset");
    expect(mail.html).toContain("Your password reset code is:");
    expect(mail.html).toContain("single-use");

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        sent: true,
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

    const { service, sendMail } = loadPasswordResetEmailService({
      upsertResult: {
        action: "cooldown",
        pending,
      },
    });

    const result = await service.sendPasswordResetEmail({
      userId: 7,
      email: "user@example.com",
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
});
