import { jest } from "@jest/globals";

import { ApiCredentialsService } from "../src/modules/api/services/api-credentials.service.js";
import { ApiCredentialsController } from "../src/modules/api/controllers/api-credentials.controller.js";
import { createMockRequest, createMockResponse } from "./http-mocks.js";

describe("ApiCredentialsController.confirmCredentials", () => {
  const token = "123456";

  function createServiceAndController() {
    const apiCredentialsEmailService = {} as never;
    const apiTokenRequestsRepository = {
      getPendingByTokenHash: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      markConfirmedById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    };
    const apiTokensRepository = {
      createToken: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    };
    const banPolicyService = {} as never;
    const databaseService = {
      withTransaction: jest.fn(async (work: (connection: object) => Promise<unknown>) =>
        work({ tx: true }),
      ),
    };
    const logger = {
      logError: jest.fn(),
    };

    const apiCredentialsService = new ApiCredentialsService(
      apiCredentialsEmailService,
      apiTokenRequestsRepository as never,
      apiTokensRepository as never,
      banPolicyService,
      databaseService as never,
      logger as never,
    );

    const controller = new ApiCredentialsController(
      apiCredentialsService as never,
    );

    return {
      controller,
      apiTokenRequestsRepository,
      apiTokensRepository,
      databaseService,
      logger,
    };
  }

  it("confirms atomically after creating the API token", async () => {
    const { controller, apiTokenRequestsRepository, apiTokensRepository } = createServiceAndController();
    const pending = {
      id: 7,
      email: "owner@example.com",
      days: 30,
    };

    apiTokenRequestsRepository.getPendingByTokenHash.mockResolvedValue(pending);
    apiTokensRepository.createToken.mockResolvedValue({ ok: true, insertId: 10 });
    apiTokenRequestsRepository.markConfirmedById.mockResolvedValue(true);

    const req = createMockRequest({
      method: "POST",
      path: "/api/credentials/confirm",
      body: { token },
      headers: { "user-agent": "Jest" },
      ip: "203.0.113.10",
    });
    const res = createMockResponse();

    await controller.confirmCredentials(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        ok: true,
        action: "api_credentials_confirm",
        confirmed: true,
        email: "owner@example.com",
        token_type: "api_key",
        expires_in_days: 30,
      }),
    );
    expect(String((res.body as { token: string }).token)).toHaveLength(64);
    const createCallOrder = apiTokensRepository.createToken.mock.invocationCallOrder[0] ?? 0;
    const confirmCallOrder =
      apiTokenRequestsRepository.markConfirmedById.mock.invocationCallOrder[0] ?? 0;
    expect(createCallOrder).toBeGreaterThan(0);
    expect(createCallOrder).toBeLessThan(confirmCallOrder);
  });

  it("rolls back and does not confirm when token creation fails", async () => {
    const { controller, apiTokenRequestsRepository, apiTokensRepository } = createServiceAndController();

    apiTokenRequestsRepository.getPendingByTokenHash.mockResolvedValue({
      id: 7,
      email: "owner@example.com",
      days: 7,
    });
    apiTokensRepository.createToken.mockRejectedValue(new Error("insert_failed"));

    const req = createMockRequest({
      method: "POST",
      path: "/api/credentials/confirm",
      body: { token },
      headers: { "user-agent": "Jest" },
    });
    const res = createMockResponse();

    await expect(controller.confirmCredentials(req, res)).rejects.toThrow("insert_failed");

    expect(apiTokenRequestsRepository.markConfirmedById).not.toHaveBeenCalled();
  });

  it("treats GET confirm as preview-only and avoids issuing a key", async () => {
    const { controller, apiTokenRequestsRepository, apiTokensRepository } = createServiceAndController();

    apiTokenRequestsRepository.getPendingByTokenHash.mockResolvedValue({
      id: 7,
      email: "owner@example.com",
      days: 30,
    });

    const req = createMockRequest({
      method: "GET",
      path: "/api/credentials/confirm",
      query: { token },
    });
    const res = createMockResponse();

    await controller.confirmCredentialsPreview(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      pending: true,
      mutation_required: true,
      email: "owner@example.com",
      days: 30,
      confirm_via: {
        method: "POST",
        path: "/api/credentials/confirm",
      },
    });
    expect(apiTokensRepository.createToken).not.toHaveBeenCalled();
    expect(apiTokenRequestsRepository.markConfirmedById).not.toHaveBeenCalled();
  });
});
