import { jest } from "@jest/globals";

import { AliasService } from "../src/modules/api/services/alias.service.js";
import { PublicHttpException } from "../src/shared/errors/public-http.exception.js";
import { PERMANENT_ALIAS_GOTO } from "../src/shared/utils/alias-policy.js";

describe("AliasService.deleteAlias", () => {
  function createService() {
    const aliasRepository = {
      getByAddress: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      deactivateByAddress: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    };
    const activityRepository = {} as never;
    const domainRepository = {} as never;
    const banPolicyService = {} as never;
    const databaseService = {
      withTransaction: jest.fn(async (work: (connection: object) => Promise<unknown>) =>
        work({ tx: true }),
      ),
    };
    const logger = {} as never;

    const service = new AliasService(
      aliasRepository as never,
      activityRepository,
      domainRepository,
      banPolicyService,
      databaseService as never,
      logger,
    );

    return { service, aliasRepository, databaseService };
  }

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
