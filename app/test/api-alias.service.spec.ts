import { jest } from "@jest/globals";

import { AliasService } from "../src/modules/api/services/alias.service.js";
import { PublicHttpException } from "../src/shared/errors/public-http.exception.js";
import { PERMANENT_ALIAS_GOTO } from "../src/shared/utils/alias-policy.js";

describe("AliasService.deleteAlias", () => {
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
    const aliasRepository = {
      getByAddress: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      deactivateByAddress: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      existsReservedHandle: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      createIfNotExists: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    };
    const activityRepository = {} as never;
    const domainRepository = {
      getEmailValidByName: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    };
    const banPolicyService = {
      findActiveNameBan: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      findActiveDomainBan: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      findActiveEmailOrDomainBan: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    };
    const databaseService = {
      withTransaction: jest.fn(async (work: (connection: object) => Promise<unknown>) =>
        work(connection),
      ),
    };
    const logger = {} as never;

    const service = new AliasService(
      aliasRepository as never,
      activityRepository,
      domainRepository as never,
      banPolicyService as never,
      databaseService as never,
      logger,
    );

    return {
      service,
      aliasRepository,
      banPolicyService,
      databaseService,
      domainRepository,
      connection,
    };
  }

  describe("createAlias", () => {
    it("checks reserved handles inside the create transaction and normalizes the owner", async () => {
      const { service, aliasRepository, banPolicyService, databaseService, domainRepository } =
        createService();

      banPolicyService.findActiveNameBan.mockResolvedValue(null);
      banPolicyService.findActiveDomainBan.mockResolvedValue(null);
      banPolicyService.findActiveEmailOrDomainBan.mockResolvedValue(null);
      domainRepository.getEmailValidByName.mockResolvedValue({ id: 3, name: "example.com" });
      aliasRepository.existsReservedHandle.mockResolvedValue(false);
      aliasRepository.createIfNotExists.mockResolvedValue({
        ok: true,
        created: true,
        insertId: 10,
      });

      const result = await service.createAlias({
        ownerEmail: " Owner@Example.com ",
        aliasHandle: "Sales",
        aliasDomain: "Example.com",
      });

      expect(result).toEqual({
        ok: true,
        created: true,
        address: "sales@example.com",
        goto: "owner@example.com",
      });
      expect(databaseService.withTransaction).toHaveBeenCalledTimes(1);
      expect(aliasRepository.existsReservedHandle).toHaveBeenCalledWith(
        "sales",
        expect.anything(),
        { forUpdate: true },
      );
      expect(aliasRepository.createIfNotExists).toHaveBeenCalledWith(
        {
          address: "sales@example.com",
          goto: "owner@example.com",
          domainId: 3,
          active: 1,
        },
        expect.anything(),
      );
    });

    it("returns alias_taken when the final insert loses a duplicate race", async () => {
      const { service, aliasRepository, banPolicyService, domainRepository } = createService();

      banPolicyService.findActiveNameBan.mockResolvedValue(null);
      banPolicyService.findActiveDomainBan.mockResolvedValue(null);
      banPolicyService.findActiveEmailOrDomainBan.mockResolvedValue(null);
      domainRepository.getEmailValidByName.mockResolvedValue({ id: 3, name: "example.com" });
      aliasRepository.existsReservedHandle.mockResolvedValue(false);
      aliasRepository.createIfNotExists.mockRejectedValue({ code: "ER_DUP_ENTRY" });

      try {
        await service.createAlias({
          ownerEmail: "owner@example.com",
          aliasHandle: "sales",
          aliasDomain: "example.com",
        });
        throw new Error("expected createAlias to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(PublicHttpException);
        expect((error as PublicHttpException).getStatus()).toBe(409);
        expect((error as PublicHttpException).getResponse()).toEqual({
          ok: false,
          error: "alias_taken",
          address: "sales@example.com",
        });
      }
    });
  });

  it("deactivates the alias instead of deleting the row", async () => {
    const { service, aliasRepository, databaseService } = createService();

    aliasRepository.getByAddress.mockResolvedValue({
      id: 5,
      address: "sales@example.com",
      goto: "owner@example.com",
      active: 1,
    });
    aliasRepository.deactivateByAddress.mockResolvedValue({
      ok: true,
      deactivated: true,
      affectedRows: 1,
    });

    await expect(
      service.deleteAlias({
        ownerEmail: "owner@example.com",
        alias: "sales@example.com",
      }),
    ).resolves.toEqual({
      ok: true,
      deleted: true,
      alias: "sales@example.com",
    });

    expect(databaseService.withTransaction).toHaveBeenCalledTimes(1);
    expect(aliasRepository.deactivateByAddress).toHaveBeenCalledWith(
      "sales@example.com",
      expect.anything(),
    );
  });

  it("rejects deletion when the alias is already inactive", async () => {
    const { service, aliasRepository } = createService();

    aliasRepository.getByAddress.mockResolvedValue({
      id: 5,
      address: "sales@example.com",
      goto: PERMANENT_ALIAS_GOTO,
      active: 0,
    });

    try {
      await service.deleteAlias({
        ownerEmail: "owner@example.com",
        alias: "sales@example.com",
      });
      throw new Error("expected deleteAlias to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PublicHttpException);
      expect((error as PublicHttpException).getStatus()).toBe(400);
      expect((error as PublicHttpException).getResponse()).toEqual({
        error: "alias_inactive",
        alias: "sales@example.com",
      });
    }

    expect(aliasRepository.deactivateByAddress).not.toHaveBeenCalled();
  });
});
