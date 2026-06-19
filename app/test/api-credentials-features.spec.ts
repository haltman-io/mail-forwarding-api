import { jest } from "@jest/globals";

import { ApiCredentialsService } from "../src/modules/api/services/api-credentials.service.js";

describe("ApiCredentialsService feature flows", () => {
  const apiKey = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  function createService() {
    const apiCredentialsEmailService = {
      sendApiTokenRequestEmail: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      sendApiTokenDestroyedEmail: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    };
    const apiTokenRequestsRepository = {
      getPendingByTokenHash: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      markConfirmedById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    };
    const apiTokensRepository = {
      createToken: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      getActiveByTokenHash: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      listActiveByOwnerEmail: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      countByOwnerEmail: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      deleteByOwnerEmail: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      renewActiveById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      setAutomaticRenewById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      getActiveMetadataById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      deleteActiveById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    };
    const banPolicyService = {
      findActiveIpBan: jest.fn<() => Promise<null>>().mockResolvedValue(null),
      findActiveEmailOrDomainBan: jest.fn<() => Promise<null>>().mockResolvedValue(null),
    };
    const databaseService = {
      withTransaction: jest.fn(async (work: (connection: object) => Promise<unknown>) =>
        work({ tx: true }),
      ),
    };
    const logger = {
      logError: jest.fn(),
    };
    const domainRepository = {
      getAdminActiveByName: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(null),
    };

    const service = new ApiCredentialsService(
      apiCredentialsEmailService as never,
      apiTokenRequestsRepository as never,
      apiTokensRepository as never,
      banPolicyService as never,
      databaseService as never,
      logger as never,
      domainRepository as never,
    );

    return {
      service,
      apiCredentialsEmailService,
      apiTokenRequestsRepository,
      apiTokensRepository,
      banPolicyService,
      databaseService,
      logger,
      domainRepository,
    };
  }

  it("rejects API key creation for managed owner domains before sending email", async () => {
    const { service, apiCredentialsEmailService, domainRepository } = createService();
    domainRepository.getAdminActiveByName.mockResolvedValueOnce({
      id: 10,
      name: "managed.example",
      active: 1,
      active_mx: 1,
      active_ui: 1,
      visible: 1,
    });

    await expect(
      service.createCredentials({
        email: "owner@managed.example",
        days: 30,
        automaticRenew: false,
        ip: "203.0.113.10",
        userAgent: "Jest",
      }),
    ).rejects.toMatchObject({
      response: {
        error: "managed_domain_not_allowed",
        domain: "managed.example",
      },
    });

    expect(apiCredentialsEmailService.sendApiTokenRequestEmail).not.toHaveBeenCalled();
  });

  it("confirms a list request and returns active token metadata", async () => {
    const { service, apiTokenRequestsRepository, apiTokensRepository } = createService();
    apiTokenRequestsRepository.getPendingByTokenHash.mockResolvedValueOnce({
      id: 7,
      email: "owner@example.com",
      action: "list",
      days: 1,
      automatic_renew: 0,
    });
    apiTokenRequestsRepository.markConfirmedById.mockResolvedValueOnce(true);
    apiTokensRepository.listActiveByOwnerEmail.mockResolvedValueOnce([
      {
        id: 3,
        owner_email: "owner@example.com",
        status: "active",
        created_at: "2026-06-01T00:00:00.000Z",
        expires_at: "2026-07-01T00:00:00.000Z",
        revoked_at: null,
        last_used_at: null,
        automatic_renew: 1,
        active: true,
      },
    ]);

    const result = await service.confirmCredentials({
      tokenRaw: "123456",
      ip: "203.0.113.10",
      userAgent: "Jest",
    });

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      ok: true,
      action: "api_credentials_list_confirm",
      email: "owner@example.com",
      items: [{ id: 3, automatic_renew: 1 }],
    });
  });

  it("confirms destroy-all and consumes the token even when there are no keys", async () => {
    const { service, apiTokenRequestsRepository, apiTokensRepository } = createService();
    apiTokenRequestsRepository.getPendingByTokenHash.mockResolvedValueOnce({
      id: 8,
      email: "owner@example.com",
      action: "destroy_all",
      days: 1,
      automatic_renew: 0,
    });
    apiTokenRequestsRepository.markConfirmedById.mockResolvedValueOnce(true);
    apiTokensRepository.countByOwnerEmail.mockResolvedValueOnce(0);

    const result = await service.confirmCredentials({
      tokenRaw: "123456",
      ip: "203.0.113.10",
      userAgent: "Jest",
    });

    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({
      ok: false,
      action: "api_credentials_destroy_all_confirm",
      error: "no_api_keys",
    });
    expect(apiTokenRequestsRepository.markConfirmedById).toHaveBeenCalledWith(8, { tx: true });
    expect(apiTokensRepository.deleteByOwnerEmail).not.toHaveBeenCalled();
  });

  it("renews an active API key by adding days to its current expiry", async () => {
    const { service, apiTokensRepository } = createService();
    apiTokensRepository.getActiveByTokenHash.mockResolvedValueOnce({
      id: 11,
      owner_email: "owner@example.com",
      status: "active",
      created_at: "2026-06-01T00:00:00.000Z",
      expires_at: "2026-06-20T00:00:00.000Z",
      revoked_at: null,
      automatic_renew: 0,
    });
    apiTokensRepository.renewActiveById.mockResolvedValueOnce(true);
    apiTokensRepository.getActiveMetadataById.mockResolvedValueOnce({
      id: 11,
      owner_email: "owner@example.com",
      expires_at: "2026-06-30T00:00:00.000Z",
      automatic_renew: 0,
      active: true,
    });

    const result = await service.renewApiKey({
      apiKeyRaw: apiKey,
      days: 10,
      ip: "203.0.113.10",
    });

    expect(apiTokensRepository.renewActiveById).toHaveBeenCalledWith(11, 10);
    expect(result).toMatchObject({
      ok: true,
      action: "api_credentials_renew",
      days_added: 10,
      item: { id: 11 },
    });
  });

  it("toggles automatic renew only for an active API key", async () => {
    const { service, apiTokensRepository } = createService();
    apiTokensRepository.getActiveByTokenHash.mockResolvedValueOnce({
      id: 12,
      owner_email: "owner@example.com",
      status: "active",
      created_at: "2026-06-01T00:00:00.000Z",
      expires_at: "2026-06-20T00:00:00.000Z",
      revoked_at: null,
      automatic_renew: 0,
    });
    apiTokensRepository.setAutomaticRenewById.mockResolvedValueOnce(true);
    apiTokensRepository.getActiveMetadataById.mockResolvedValueOnce({
      id: 12,
      owner_email: "owner@example.com",
      automatic_renew: 1,
      active: true,
    });

    const result = await service.setAutomaticRenew({
      apiKeyRaw: apiKey,
      automaticRenew: true,
      ip: "203.0.113.10",
    });

    expect(apiTokensRepository.setAutomaticRenewById).toHaveBeenCalledWith(12, true);
    expect(result).toMatchObject({
      ok: true,
      action: "api_credentials_automatic_renew",
      automatic_renew: true,
    });
  });

  it("destroys an active API key and sends a notification email", async () => {
    const { service, apiCredentialsEmailService, apiTokensRepository } = createService();
    apiTokensRepository.getActiveByTokenHash.mockResolvedValueOnce({
      id: 13,
      owner_email: "owner@example.com",
      status: "active",
      created_at: "2026-06-01T00:00:00.000Z",
      expires_at: "2026-06-20T00:00:00.000Z",
      revoked_at: null,
      automatic_renew: 0,
    });
    apiTokensRepository.deleteActiveById.mockResolvedValueOnce(true);
    apiCredentialsEmailService.sendApiTokenDestroyedEmail.mockResolvedValueOnce(undefined);

    const result = await service.destroyApiKey({
      apiKeyRaw: apiKey,
      ip: "203.0.113.10",
      userAgent: "Jest",
    });

    expect(apiTokensRepository.deleteActiveById).toHaveBeenCalledWith(13);
    expect(apiCredentialsEmailService.sendApiTokenDestroyedEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: "owner@example.com" }),
    );
    expect(result).toMatchObject({
      ok: true,
      action: "api_credentials_destroy",
      destroyed: true,
      notification_sent: true,
    });
  });
});
