import { jest } from "@jest/globals";

import { EmailConfirmationService } from "../src/modules/forwarding/services/email-confirmation.service.js";

describe("EmailConfirmationService", () => {
  function createService() {
    const configService = {
      getOrThrow: jest.fn((key: string) => {
        if (key === "forwarding") {
          return {
            confirmEndpoint: "/api/forward/confirm",
            emailConfirmationTtlMinutes: 10,
            emailConfirmationResendCooldownSeconds: 0,
            emailSubject: "Confirm your email",
            emailSubjectSubscribe: "Confirm subscribe",
            emailSubjectUnsubscribe: "Confirm unsubscribe",
          };
        }

        if (key === "smtp") {
          return {
            host: "smtp.example.com",
            port: 587,
            secure: false,
            authEnabled: false,
            user: "",
            pass: "",
            from: "noreply@example.com",
            heloName: "mailer.example.com",
            tlsRejectUnauthorized: true,
          };
        }

        if (key === "app") {
          return {
            publicUrl: "https://panel.example.com",
          };
        }

        throw new Error(`unexpected config key: ${key}`);
      }),
    };
    const emailConfirmationsRepository = {
      getActivePendingByRequest: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      rotateTokenForPending: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      createPending: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    };
    const originPolicy = {
      resolveAllowedOrigin: jest.fn((origin: string) =>
        origin === "https://tenant.example.com" ? origin : null,
      ),
    };
    const sendMail = jest.fn<() => Promise<void>>().mockImplementation(async () => undefined);

    const service = new EmailConfirmationService(
      configService as never,
      emailConfirmationsRepository as never,
      originPolicy as never,
    );

    Object.defineProperty(service, "createTransport", {
      value: jest.fn(() => ({ sendMail })),
    });

    return {
      service,
      emailConfirmationsRepository,
      originPolicy,
      sendMail,
    };
  }

  it("uses the full request tuple when looking up pending confirmations", async () => {
    const { service, emailConfirmationsRepository } = createService();

    emailConfirmationsRepository.getActivePendingByRequest.mockResolvedValue(null);
    emailConfirmationsRepository.createPending.mockResolvedValue({ id: 1 });

    await service.sendEmailConfirmation({
      email: "owner@example.com",
      requestIpText: "203.0.113.10",
      userAgent: "Jest",
      aliasName: "sales",
      aliasDomain: "example.com",
      intent: "subscribe",
    });

    await service.sendEmailConfirmation({
      email: "owner@example.com",
      requestIpText: "203.0.113.10",
      userAgent: "Jest",
      aliasName: "billing",
      aliasDomain: "example.com",
      intent: "unsubscribe",
    });

    expect(emailConfirmationsRepository.getActivePendingByRequest.mock.calls).toEqual([
      [
        {
          email: "owner@example.com",
          intent: "subscribe",
          aliasName: "sales",
          aliasDomain: "example.com",
        },
      ],
      [
        {
          email: "owner@example.com",
          intent: "unsubscribe",
          aliasName: "billing",
          aliasDomain: "example.com",
        },
      ],
    ]);
  });

  it("reuses only an exact pending request and rotates it by pending id", async () => {
    const { service, emailConfirmationsRepository } = createService();

    emailConfirmationsRepository.getActivePendingByRequest.mockResolvedValue({
      id: 42,
      last_sent_at: null,
    });
    emailConfirmationsRepository.rotateTokenForPending.mockResolvedValue(true);

    await service.sendEmailConfirmation({
      email: "owner@example.com",
      requestIpText: "203.0.113.10",
      userAgent: "Jest",
      aliasName: "sales",
      aliasDomain: "example.com",
      intent: "subscribe",
    });

    expect(emailConfirmationsRepository.rotateTokenForPending).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingId: 42,
        ttlMinutes: 10,
      }),
    );
    expect(emailConfirmationsRepository.createPending).not.toHaveBeenCalled();
  });

  it("uses only allowlisted origins for confirmation links", async () => {
    const { service, originPolicy, sendMail, emailConfirmationsRepository } = createService();

    emailConfirmationsRepository.getActivePendingByRequest.mockResolvedValue(null);
    emailConfirmationsRepository.createPending.mockResolvedValue({ id: 1 });

    await service.sendEmailConfirmation({
      email: "owner@example.com",
      requestIpText: "203.0.113.10",
      userAgent: "Jest",
      aliasName: "sales",
      aliasDomain: "example.com",
      intent: "subscribe",
      requestOrigin: "https://tenant.example.com",
      requestReferer: "https://malicious.example.net/welcome?token=leak",
    });

    expect(originPolicy.resolveAllowedOrigin).toHaveBeenCalledWith("https://tenant.example.com");
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining("https://tenant.example.com/api/forward/confirm?token="),
      }),
    );
  });
});
