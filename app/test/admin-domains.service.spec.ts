import { jest } from "@jest/globals";

import { AdminDomainsService } from "../src/modules/admin/domains/admin-domains.service.js";
import { PublicHttpException } from "../src/shared/errors/public-http.exception.js";

describe("AdminDomainsService", () => {
  function createService() {
    const adminDomainsRepository = {
      listAll: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      countAll: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      getById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      getByName: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      createDomain: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      updateById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      deleteById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    };
    const banPolicyService = {
      findActiveDomainBan: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    };
    const checkDnsClient = {
      recheckAllDomains: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      recheckDomain: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    };
    const logger = {
      info: jest.fn(),
      error: jest.fn(),
    };

    return {
      service: new AdminDomainsService(
        adminDomainsRepository as never,
        banPolicyService as never,
        checkDnsClient as never,
        logger as never,
      ),
      adminDomainsRepository,
      banPolicyService,
      checkDnsClient,
      logger,
    };
  }

  it("passes visible filters to the repository when listing domains", async () => {
    const { service, adminDomainsRepository } = createService();
    adminDomainsRepository.listAll.mockResolvedValue([]);
    adminDomainsRepository.countAll.mockResolvedValue(0);

    await service.listDomains({ active: 1, visible: 0 });

    expect(adminDomainsRepository.listAll).toHaveBeenCalledWith(
      expect.objectContaining({ active: 1, visible: 0 }),
    );
    expect(adminDomainsRepository.countAll).toHaveBeenCalledWith(
      expect.objectContaining({ active: 1, visible: 0 }),
    );
  });

  it("defaults created domains to visible without granting DNS approval", async () => {
    const { service, adminDomainsRepository, banPolicyService } = createService();
    banPolicyService.findActiveDomainBan.mockResolvedValue(null);
    adminDomainsRepository.getByName.mockResolvedValue(null);
    adminDomainsRepository.createDomain.mockResolvedValue({ ok: true, insertId: 10 });
    adminDomainsRepository.getById.mockResolvedValue({
      id: 10,
      name: "example.com",
      active: 1,
      active_mx: 0,
      active_ui: 0,
      visible: 1,
    });

    const result = await service.createDomain({ name: "Example.COM" });

    expect(adminDomainsRepository.createDomain).toHaveBeenCalledWith({
      name: "example.com",
      active: 1,
      visible: 1,
    });
    expect(result.item).toEqual(
      expect.objectContaining({
        active_mx: 0,
        active_ui: 0,
        visible: 1,
      }),
    );
  });

  it("updates active and visible but not DNS approval gates", async () => {
    const { service, adminDomainsRepository, banPolicyService } = createService();
    banPolicyService.findActiveDomainBan.mockResolvedValue(null);
    adminDomainsRepository.getById
      .mockResolvedValueOnce({
        id: 10,
        name: "example.com",
        active: 1,
        active_mx: 1,
        active_ui: 1,
        visible: 1,
      })
      .mockResolvedValueOnce({
        id: 10,
        name: "example.com",
        active: 1,
        active_mx: 1,
        active_ui: 1,
        visible: 0,
      });
    adminDomainsRepository.updateById.mockResolvedValue(true);

    await service.updateDomain(10, { visible: 0 });

    expect(adminDomainsRepository.updateById).toHaveBeenCalledWith(10, { visible: 0 });
  });

  it("relays all-domain recheck responses from the DNS checker", async () => {
    const { service, checkDnsClient } = createService();
    checkDnsClient.recheckAllDomains.mockResolvedValue({
      status: 202,
      data: { ok: true, queued: "all" },
    });

    await expect(service.recheckAllDomains()).resolves.toEqual({
      status: 202,
      payload: { ok: true, queued: "all" },
    });
  });

  it("loads a domain by id before relaying single-domain rechecks", async () => {
    const { service, adminDomainsRepository, checkDnsClient } = createService();
    adminDomainsRepository.getById.mockResolvedValue({
      id: 10,
      name: "Example.COM.",
      active: 1,
      active_mx: 1,
      active_ui: 1,
      visible: 1,
    });
    checkDnsClient.recheckDomain.mockResolvedValue({
      status: 200,
      data: { ok: true, target: "example.com" },
    });

    await expect(service.recheckDomain(10)).resolves.toEqual({
      status: 200,
      payload: { ok: true, target: "example.com" },
    });
    expect(checkDnsClient.recheckDomain).toHaveBeenCalledWith("example.com");
  });

  it("does not call the DNS checker for missing single-domain rechecks", async () => {
    const { service, adminDomainsRepository, checkDnsClient } = createService();
    adminDomainsRepository.getById.mockResolvedValue(null);

    await expect(service.recheckDomain(999)).rejects.toBeInstanceOf(PublicHttpException);
    expect(checkDnsClient.recheckDomain).not.toHaveBeenCalled();
  });
});
