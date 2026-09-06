import { jest } from "@jest/globals";

import { HandleApiService } from "../src/modules/handle/services/handle-api.service.js";
import { PublicHttpException } from "../src/shared/errors/public-http.exception.js";

function createService() {
  const handleRepository = {
    existsByHandle: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    createHandle: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    getActiveByHandle: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    unsubscribe: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  };
  const handleDisabledDomainRepository = {
    disableDomain: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    enableDomain: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  };
  const aliasRepository = {
    findActiveByLocalPart: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    deleteActiveByIdsAndOwner: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  };
  const banPolicyService = {
    findActiveNameBan: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    findActiveEmailOrDomainBan: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  };
  const databaseService = {
    withTransaction: jest.fn(
      async (work: (connection: object) => Promise<unknown>) => work({ tx: true }),
    ),
  };

  const service = new HandleApiService(
    handleRepository as never,
    handleDisabledDomainRepository as never,
    aliasRepository as never,
    banPolicyService as never,
    databaseService as never,
  );

  return {
    service,
    handleRepository,
    handleDisabledDomainRepository,
    aliasRepository,
    banPolicyService,
    databaseService,
  };
}

describe("HandleApiService.createHandle", () => {
  it("converts existing aliases to handle when all belong to the same owner (Scenario A)", async () => {
    const { service, handleRepository, aliasRepository, banPolicyService, databaseService } =
      createService();

    banPolicyService.findActiveNameBan.mockResolvedValue(null);
    banPolicyService.findActiveEmailOrDomainBan.mockResolvedValue(null);
    handleRepository.existsByHandle.mockResolvedValue(false);

    const activeAliases = [
      { id: 1, address: "joao@dominio1.com", goto: "joao@gmail.com", active: 1 },
      { id: 2, address: "joao@dominio2.com", goto: "joao@gmail.com", active: 1 },
    ];
    aliasRepository.findActiveByLocalPart.mockResolvedValue(activeAliases);
    handleRepository.createHandle.mockResolvedValue({ ok: true, insertId: 10 });
    aliasRepository.deleteActiveByIdsAndOwner.mockResolvedValue(2);

    const result = await service.createHandle({
      ownerEmail: "joao@gmail.com",
      handle: "joao",
    });

    expect(result).toEqual({
      ok: true,
      created: true,
      handle: "joao",
      goto: "joao@gmail.com",
      converted_aliases: ["joao@dominio1.com", "joao@dominio2.com"],
    });

    expect(databaseService.withTransaction).toHaveBeenCalledTimes(1);
    expect(handleRepository.existsByHandle).toHaveBeenCalledWith(
      "joao",
      expect.anything(),
      { forUpdate: true },
    );
    expect(handleRepository.createHandle).toHaveBeenCalledWith(
      { handle: "joao", address: "joao@gmail.com", active: 1 },
      expect.anything(),
    );
    expect(aliasRepository.deleteActiveByIdsAndOwner).toHaveBeenCalledWith(
      [1, 2],
      "joao@gmail.com",
      expect.anything(),
    );
  });

  it("creates handle normally when no existing aliases exist (Scenario C)", async () => {
    const { service, handleRepository, aliasRepository, banPolicyService } = createService();

    banPolicyService.findActiveNameBan.mockResolvedValue(null);
    banPolicyService.findActiveEmailOrDomainBan.mockResolvedValue(null);
    handleRepository.existsByHandle.mockResolvedValue(false);
    aliasRepository.findActiveByLocalPart.mockResolvedValue([]);
    handleRepository.createHandle.mockResolvedValue({ ok: true, insertId: 11 });

    const result = await service.createHandle({
      ownerEmail: "maria@gmail.com",
      handle: "maria",
    });

    expect(result).toEqual({
      ok: true,
      created: true,
      handle: "maria",
      goto: "maria@gmail.com",
    });

    expect(aliasRepository.deleteActiveByIdsAndOwner).not.toHaveBeenCalled();
  });

  it("normalizes the API owner before ownership checks, writes, deletes, and response", async () => {
    const { service, handleRepository, aliasRepository, banPolicyService } = createService();

    banPolicyService.findActiveNameBan.mockResolvedValue(null);
    banPolicyService.findActiveEmailOrDomainBan.mockResolvedValue(null);
    handleRepository.existsByHandle.mockResolvedValue(false);
    aliasRepository.findActiveByLocalPart.mockResolvedValue([
      { id: 1, address: "joao@dominio1.com", goto: "joao@gmail.com", active: 1 },
    ]);
    handleRepository.createHandle.mockResolvedValue({ ok: true, insertId: 10 });
    aliasRepository.deleteActiveByIdsAndOwner.mockResolvedValue(1);

    const result = await service.createHandle({
      ownerEmail: " Joao@Gmail.com ",
      handle: "Joao",
    });

    expect(result).toEqual({
      ok: true,
      created: true,
      handle: "joao",
      goto: "joao@gmail.com",
      converted_aliases: ["joao@dominio1.com"],
    });
    expect(banPolicyService.findActiveEmailOrDomainBan).toHaveBeenCalledWith("joao@gmail.com");
    expect(handleRepository.createHandle).toHaveBeenCalledWith(
      { handle: "joao", address: "joao@gmail.com", active: 1 },
      expect.anything(),
    );
    expect(aliasRepository.deleteActiveByIdsAndOwner).toHaveBeenCalledWith(
      [1],
      "joao@gmail.com",
      expect.anything(),
    );
  });

  it("rejects and rolls back when the converted alias delete count does not match the locked aliases", async () => {
    const { service, handleRepository, aliasRepository, banPolicyService } = createService();

    banPolicyService.findActiveNameBan.mockResolvedValue(null);
    banPolicyService.findActiveEmailOrDomainBan.mockResolvedValue(null);
    handleRepository.existsByHandle.mockResolvedValue(false);
    aliasRepository.findActiveByLocalPart.mockResolvedValue([
      { id: 1, address: "joao@dominio1.com", goto: "joao@gmail.com", active: 1 },
      { id: 2, address: "joao@dominio2.com", goto: "joao@gmail.com", active: 1 },
    ]);
    handleRepository.createHandle.mockResolvedValue({ ok: true, insertId: 10 });
    aliasRepository.deleteActiveByIdsAndOwner.mockResolvedValue(1);

    try {
      await service.createHandle({
        ownerEmail: "joao@gmail.com",
        handle: "joao",
      });
      throw new Error("expected createHandle to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PublicHttpException);
      expect((error as PublicHttpException).getStatus()).toBe(409);
      expect((error as PublicHttpException).getResponse()).toEqual({
        ok: false,
        error: "alias_conversion_state_changed",
      });
    }
  });

  it("rejects with 409 alias_taken when an active alias belongs to another owner (Scenario B)", async () => {
    const { service, handleRepository, aliasRepository, banPolicyService } = createService();

    banPolicyService.findActiveNameBan.mockResolvedValue(null);
    banPolicyService.findActiveEmailOrDomainBan.mockResolvedValue(null);
    handleRepository.existsByHandle.mockResolvedValue(false);

    const activeAliases = [
      { id: 1, address: "joao@dominio1.com", goto: "other@gmail.com", active: 1 },
    ];
    aliasRepository.findActiveByLocalPart.mockResolvedValue(activeAliases);

    try {
      await service.createHandle({
        ownerEmail: "joao@gmail.com",
        handle: "joao",
      });
      throw new Error("expected createHandle to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PublicHttpException);
      expect((error as PublicHttpException).getStatus()).toBe(409);
      expect((error as PublicHttpException).getResponse()).toEqual({
        ok: false,
        error: "alias_taken",
      });
    }

    expect(handleRepository.createHandle).not.toHaveBeenCalled();
  });

  it("rejects with 409 alias_taken when handle is already registered in alias_handle", async () => {
    const { service, handleRepository, banPolicyService, databaseService } = createService();

    banPolicyService.findActiveNameBan.mockResolvedValue(null);
    banPolicyService.findActiveEmailOrDomainBan.mockResolvedValue(null);
    handleRepository.existsByHandle.mockResolvedValue(true);

    await expect(
      service.createHandle({
        ownerEmail: "joao@gmail.com",
        handle: "joao",
      }),
    ).rejects.toThrow(PublicHttpException);

    expect(databaseService.withTransaction).toHaveBeenCalledTimes(1);
  });

  it("rejects with 403 banned when handle name is banned", async () => {
    const { service, banPolicyService } = createService();

    banPolicyService.findActiveNameBan.mockResolvedValue({
      id: 1,
      ban_type: "name",
      ban_value: "admin",
    });

    await expect(
      service.createHandle({
        ownerEmail: "admin@example.com",
        handle: "admin",
      }),
    ).rejects.toThrow(PublicHttpException);
  });

  it("rejects with 403 banned when the API owner email or domain is banned", async () => {
    const { service, banPolicyService, databaseService } = createService();

    banPolicyService.findActiveNameBan.mockResolvedValue(null);
    banPolicyService.findActiveEmailOrDomainBan.mockResolvedValue({
      id: 2,
      ban_type: "email",
      ban_value: "owner@example.com",
    });

    try {
      await service.createHandle({
        ownerEmail: "owner@example.com",
        handle: "owner",
      });
      throw new Error("expected createHandle to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PublicHttpException);
      expect((error as PublicHttpException).getStatus()).toBe(403);
    }

    expect(databaseService.withTransaction).not.toHaveBeenCalled();
  });

  it("rejects with 400 invalid_params when handle format is invalid", async () => {
    const { service } = createService();

    await expect(
      service.createHandle({
        ownerEmail: "test@example.com",
        handle: "inv@lid",
      }),
    ).rejects.toThrow(PublicHttpException);
  });
});
