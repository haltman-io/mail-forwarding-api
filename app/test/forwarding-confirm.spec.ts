import { jest } from "@jest/globals";

import { ForwardingService } from "../src/modules/forwarding/services/forwarding.service.js";
import { ForwardingController } from "../src/modules/forwarding/forwarding.controller.js";
import { createMockRequest, createMockResponse } from "./http-mocks.js";

describe("ForwardingController.confirm", () => {
  const token = "123456";

  function createServiceAndController() {
    const emailConfirmationService = {} as never;
    const emailConfirmationsRepository = {
      getPendingByTokenHash: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      markConfirmedById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    };
    const aliasRepository = {
      getByAddress: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      deleteByAddress: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      existsReservedHandle: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      createIfNotExists: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    };
    const domainRepository = {
      getActiveByName: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    };
    const banPolicyService = {
      findActiveNameBan: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      findActiveDomainBan: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      findActiveEmailOrDomainBan: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    };
    const configService = {} as never;
    const databaseService = {
      withTransaction: jest.fn(async (work: (connection: object) => Promise<unknown>) =>
        work({ tx: true }),
      ),
    };
    const logger = {
      logError: jest.fn(),
    };

    const forwardingService = new ForwardingService(
      emailConfirmationService,
      emailConfirmationsRepository as never,
      aliasRepository as never,
      domainRepository as never,
      banPolicyService as never,
      configService,
      databaseService as never,
      logger as never,
    );

    const controller = new ForwardingController(
      forwardingService as never,
    );

    return {
      controller,
      emailConfirmationsRepository,
      aliasRepository,
      domainRepository,
      banPolicyService,
      logger,
    };
  }

  it("confirms unsubscribe only after deleting the alias", async () => {
    const { controller, emailConfirmationsRepository, aliasRepository } = createServiceAndController();
    const pending = {
      id: 12,
      email: "owner@example.com",
      intent: "unsubscribe",
      alias_name: "sales",
      alias_domain: "example.com",
    };

    emailConfirmationsRepository.getPendingByTokenHash
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending);
    aliasRepository.getByAddress.mockResolvedValue({
      id: 4,
      goto: "owner@example.com",
    });
    aliasRepository.deleteByAddress.mockResolvedValue({ ok: true, deleted: true, affectedRows: 1 });
    emailConfirmationsRepository.markConfirmedById.mockResolvedValue(true);

    const req = createMockRequest({
      method: "POST",
      path: "/api/forward/confirm",
      body: { token },
    });
    const res = createMockResponse();

    await controller.confirm(req.body as never, req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      confirmed: true,
      intent: "unsubscribe",
      removed: true,
      address: "sales@example.com",
    });
    const deleteCallOrder = aliasRepository.deleteByAddress.mock.invocationCallOrder[0] ?? 0;
    const confirmCallOrder =
      emailConfirmationsRepository.markConfirmedById.mock.invocationCallOrder[0] ?? 0;
    expect(deleteCallOrder).toBeGreaterThan(0);
    expect(deleteCallOrder).toBeLessThan(confirmCallOrder);
  });

  it("does not consume the token when unsubscribe validation fails", async () => {
    const { controller, emailConfirmationsRepository, aliasRepository } = createServiceAndController();
    const pending = {
      id: 12,
      email: "owner@example.com",
      intent: "unsubscribe",
      alias_name: "sales",
      alias_domain: "example.com",
    };

    emailConfirmationsRepository.getPendingByTokenHash
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending);
    aliasRepository.getByAddress.mockResolvedValue({
      id: 4,
      goto: "other@example.com",
    });

    const req = createMockRequest({
      method: "POST",
      path: "/api/forward/confirm",
      body: { token },
    });
    const res = createMockResponse();

    await controller.confirm(req.body as never, req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      ok: false,
      error: "alias_owner_changed",
      address: "sales@example.com",
    });
    expect(emailConfirmationsRepository.markConfirmedById).not.toHaveBeenCalled();
  });

  it("marks subscribe confirmation after resolving the already-exists outcome", async () => {
    const {
      controller,
      emailConfirmationsRepository,
      aliasRepository,
      domainRepository,
      banPolicyService,
    } = createServiceAndController();
    const pending = {
      id: 12,
      email: "owner@example.com",
      intent: "subscribe",
      alias_name: "sales",
      alias_domain: "example.com",
    };

    emailConfirmationsRepository.getPendingByTokenHash
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending);
    domainRepository.getActiveByName.mockResolvedValue({
      id: 9,
      name: "example.com",
      active: 1,
    });
    banPolicyService.findActiveNameBan.mockResolvedValue(null);
    banPolicyService.findActiveDomainBan.mockResolvedValue(null);
    banPolicyService.findActiveEmailOrDomainBan.mockResolvedValue(null);
    aliasRepository.getByAddress.mockResolvedValue({
      id: 4,
      goto: "owner@example.com",
    });
    emailConfirmationsRepository.markConfirmedById.mockResolvedValue(true);

    const req = createMockRequest({
      method: "POST",
      path: "/api/forward/confirm",
      body: { token },
    });
    const res = createMockResponse();

    await controller.confirm(req.body as never, req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      confirmed: true,
      intent: "subscribe",
      created: false,
      reason: "already_exists",
      address: "sales@example.com",
      goto: "owner@example.com",
    });
    expect(emailConfirmationsRepository.markConfirmedById).toHaveBeenCalled();
  });

  it("treats GET confirm as a preview and does not mutate state", async () => {
    const { controller, emailConfirmationsRepository } = createServiceAndController();

    emailConfirmationsRepository.getPendingByTokenHash.mockResolvedValue({
      id: 12,
      email: "owner@example.com",
      intent: "subscribe",
      alias_name: "sales",
      alias_domain: "example.com",
    });

    const req = createMockRequest({
      method: "GET",
      path: "/api/forward/confirm",
      query: { token },
    });
    const res = createMockResponse();

    await controller.confirmPreview(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      pending: true,
      mutation_required: true,
      intent: "subscribe",
      address: "sales@example.com",
      goto: "owner@example.com",
      confirm_via: {
        method: "POST",
        path: "/api/forward/confirm",
      },
    });
    expect(emailConfirmationsRepository.markConfirmedById).not.toHaveBeenCalled();
  });

  it("returns conflict instead of consuming subscribe confirmation after owner drift", async () => {
    const {
      controller,
      emailConfirmationsRepository,
      aliasRepository,
      domainRepository,
      banPolicyService,
    } = createServiceAndController();

    const pending = {
      id: 12,
      email: "owner@example.com",
      intent: "subscribe",
      alias_name: "sales",
      alias_domain: "example.com",
    };

    emailConfirmationsRepository.getPendingByTokenHash
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending);
    domainRepository.getActiveByName.mockResolvedValue({
      id: 9,
      name: "example.com",
      active: 1,
    });
    banPolicyService.findActiveNameBan.mockResolvedValue(null);
    banPolicyService.findActiveDomainBan.mockResolvedValue(null);
    banPolicyService.findActiveEmailOrDomainBan.mockResolvedValue(null);
    aliasRepository.getByAddress.mockResolvedValue({
      id: 4,
      goto: "other@example.com",
    });

    const req = createMockRequest({
      method: "POST",
      path: "/api/forward/confirm",
      body: { token },
    });
    const res = createMockResponse();

    await controller.confirm(req.body as never, req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({
      ok: false,
      error: "alias_owner_changed",
      address: "sales@example.com",
    });
    expect(emailConfirmationsRepository.markConfirmedById).not.toHaveBeenCalled();
  });
});
