import { jest } from "@jest/globals";

import { AdminHandlesService } from "../src/modules/admin/handles/admin-handles.service.js";

function createService() {
  const database = {
    withTransaction: jest.fn(
      async (work: (connection: object) => Promise<unknown>) => work({ tx: true }),
    ),
  };
  const adminHandlesRepository = {
    getByHandle: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    getById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    createHandle: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    updateById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  };
  const banPolicyService = {
    findActiveNameBan: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    findActiveEmailOrDomainBan: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  };

  const service = new AdminHandlesService(
    database as never,
    adminHandlesRepository as never,
    banPolicyService as never,
  );

  return {
    service,
    database,
    adminHandlesRepository,
    banPolicyService,
  };
}

describe("AdminHandlesService", () => {
  it("creates an active handle even when an alias already uses the same local part", async () => {
    const { service, adminHandlesRepository, banPolicyService } = createService();

    banPolicyService.findActiveNameBan.mockResolvedValue(null);
    banPolicyService.findActiveEmailOrDomainBan.mockResolvedValue(null);
    adminHandlesRepository.getByHandle.mockResolvedValue(null);
    adminHandlesRepository.createHandle.mockResolvedValue({
      ok: true,
      insertId: 14,
    });
    adminHandlesRepository.getById.mockResolvedValue({
      id: 14,
      handle: "sales",
      address: "owner@example.com",
      active: 1,
    });

    const result = await service.createHandle({
      handle: "sales",
      address: "owner@example.com",
      active: 1,
    });

    expect(result).toEqual({
      ok: true,
      created: true,
      item: {
        id: 14,
        handle: "sales",
        address: "owner@example.com",
        active: 1,
      },
    });
    expect(adminHandlesRepository.createHandle).toHaveBeenCalledWith(
      {
        handle: "sales",
        address: "owner@example.com",
        active: 1,
      },
      expect.any(Object),
    );
  });

  it("allows reactivating a handle even when an alias already uses the same local part", async () => {
    const { service, adminHandlesRepository, banPolicyService } = createService();

    banPolicyService.findActiveNameBan.mockResolvedValue(null);
    banPolicyService.findActiveEmailOrDomainBan.mockResolvedValue(null);
    adminHandlesRepository.getById
      .mockResolvedValueOnce({
        id: 14,
        handle: "sales",
        address: "owner@example.com",
        active: 0,
      })
      .mockResolvedValueOnce({
        id: 14,
        handle: "sales",
        address: "owner@example.com",
        active: 1,
      });
    adminHandlesRepository.updateById.mockResolvedValue(true);

    const result = await service.updateHandle(14, { active: 1 });

    expect(result).toEqual({
      ok: true,
      updated: true,
      item: {
        id: 14,
        handle: "sales",
        address: "owner@example.com",
        active: 1,
      },
    });
    expect(adminHandlesRepository.updateById).toHaveBeenCalledWith(
      14,
      { active: 1 },
      expect.any(Object),
    );
  });
});
