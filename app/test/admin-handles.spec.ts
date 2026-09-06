import { jest } from "@jest/globals";

import { AdminHandlesService } from "../src/modules/admin/handles/admin-handles.service.js";

function createTxConnection() {
  return {
    tx: true,
    query: jest.fn((sql: string) =>
      Promise.resolve(sql.includes("GET_LOCK") ? [{ acquired: 1 }] : [{ released: 1 }]),
    ),
  };
}

function createService() {
  const connection = createTxConnection();
  const database = {
    withTransaction: jest.fn(
      async (work: (connection: object) => Promise<unknown>) => work(connection),
    ),
  };
  const adminHandlesRepository = {
    getByHandle: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    getById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    createHandle: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    updateById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  };
  const adminAliasesRepository = {
    existsActiveAliasByLocalPart: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  };
  const banPolicyService = {
    findActiveNameBan: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    findActiveEmailOrDomainBan: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  };

  const creationNotificationService = {
    notifyHandleCreated: jest.fn(),
  };

  const service = new AdminHandlesService(
    database as never,
    adminHandlesRepository as never,
    adminAliasesRepository as never,
    banPolicyService as never,
    creationNotificationService as never,
  );

  return {
    service,
    database,
    adminHandlesRepository,
    adminAliasesRepository,
    banPolicyService,
    connection,
  };
}

describe("AdminHandlesService", () => {
  it("rejects handle creation when an active alias already uses the same local part", async () => {
    const { service, adminHandlesRepository, adminAliasesRepository, banPolicyService } =
      createService();

    banPolicyService.findActiveNameBan.mockResolvedValue(null);
    banPolicyService.findActiveEmailOrDomainBan.mockResolvedValue(null);
    adminHandlesRepository.getByHandle.mockResolvedValue(null);
    adminAliasesRepository.existsActiveAliasByLocalPart.mockResolvedValue(true);

    await expect(
      service.createHandle({
        handle: "sales",
        address: "owner@example.com",
        active: 1,
      }),
    ).rejects.toMatchObject({
      response: { error: "alias_taken", handle: "sales" },
    });

    expect(adminAliasesRepository.existsActiveAliasByLocalPart).toHaveBeenCalledWith(
      "sales",
      expect.any(Object),
      { forUpdate: true },
    );
    expect(adminHandlesRepository.createHandle).not.toHaveBeenCalled();
  });

  it("creates an active handle when no alias uses the same local part", async () => {
    const { service, adminHandlesRepository, adminAliasesRepository, banPolicyService } =
      createService();

    banPolicyService.findActiveNameBan.mockResolvedValue(null);
    banPolicyService.findActiveEmailOrDomainBan.mockResolvedValue(null);
    adminHandlesRepository.getByHandle.mockResolvedValue(null);
    adminAliasesRepository.existsActiveAliasByLocalPart.mockResolvedValue(false);
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

  it("rejects reactivating a handle when an active alias already uses the same local part", async () => {
    const { service, adminHandlesRepository, adminAliasesRepository, banPolicyService } =
      createService();

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
    adminAliasesRepository.existsActiveAliasByLocalPart.mockResolvedValue(true);

    await expect(service.updateHandle(14, { active: 1 })).rejects.toMatchObject({
      response: { error: "alias_taken", handle: "sales" },
    });

    expect(adminAliasesRepository.existsActiveAliasByLocalPart).toHaveBeenCalledWith(
      "sales",
      expect.any(Object),
      { forUpdate: true },
    );
    expect(adminHandlesRepository.updateById).not.toHaveBeenCalled();
  });
});
