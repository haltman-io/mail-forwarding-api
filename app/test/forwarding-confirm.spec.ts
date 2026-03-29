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
      deactivateByAddress: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
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

  it("confirms unsubscribe only after deactivating the alias", async () => {
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
      active: 1,
    });
    aliasRepository.deactivateByAddress.mockResolvedValue({
      ok: true,
      deactivated: true,
      affectedRows: 1,
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
      intent: "unsubscribe",
      removed: true,
      address: "sales@example.com",
    });
    const deactivateCallOrder = aliasRepository.deactivateByAddress.mock.invocationCallOrder[0] ?? 0;
    const confirmCallOrder =
      emailConfirmationsRepository.markConfirmedById.mock.invocationCallOrder[0] ?? 0;
    expect(deactivateCallOrder).toBeGreaterThan(0);
    expect(deactivateCallOrder).toBeLessThan(confirmCallOrder);
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
      active: 1,
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

  it("does not consume the token when unsubscribe finds an inactive alias", async () => {
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
      goto: "alias@haltman.io",
      active: 0,
    });

    const req = createMockRequest({
      method: "POST",
      path: "/api/forward/confirm",
      body: { token },
    });
    const res = createMockResponse();

    await controller.confirm(req.body as never, req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      ok: false,
      error: "alias_inactive",
      alias: "sales@example.com",
    });
    expect(aliasRepository.deactivateByAddress).not.toHaveBeenCalled();
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
      active: 1,
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

  it("GET confirm executes confirmation directly and returns JSON", async () => {
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
    aliasRepository.getByAddress.mockResolvedValue(null);
    aliasRepository.existsReservedHandle.mockResolvedValue(false);
    aliasRepository.createIfNotExists.mockResolvedValue({
      ok: true,
      created: true,
    });
    emailConfirmationsRepository.markConfirmedById.mockResolvedValue(true);

    const req = createMockRequest({
      method: "GET",
      path: "/api/forward/confirm",
      query: { token },
    });
    const res = createMockResponse();

    await controller.confirmGet(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.confirmed).toBe(true);
    expect(body.intent).toBe("subscribe");
    expect(emailConfirmationsRepository.markConfirmedById).toHaveBeenCalled();
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
      active: 1,
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
