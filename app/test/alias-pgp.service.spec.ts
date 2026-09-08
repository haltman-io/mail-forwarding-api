import { jest } from "@jest/globals";

import { AliasPgpService } from "../src/modules/api/services/alias-pgp.service.js";
import { PublicHttpException } from "../src/shared/errors/public-http.exception.js";

function createTxConnection() {
  return { tx: true };
}

function createService() {
  const connection = createTxConnection();
  const aliasRepository = {
    getByAddress: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    updatePgpById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    clearPgpById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  };
  const databaseService = {
    withTransaction: jest.fn(async (work: (connection: object) => Promise<unknown>) =>
      work(connection),
    ),
  };
  const pgpKeyService = {
    validatePublicKey: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  };

  const service = new AliasPgpService(
    aliasRepository as never,
    databaseService as never,
    pgpKeyService as never,
  );

  return { service, aliasRepository, databaseService, pgpKeyService, connection };
}

describe("AliasPgpService", () => {
  it("validates ownership and stores normalized PGP settings", async () => {
    const { service, aliasRepository, pgpKeyService, connection } = createService();
    aliasRepository.getByAddress.mockResolvedValue({
      id: 5,
      address: "sales@example.com",
      goto: "owner@example.com",
      active: 1,
    });
    aliasRepository.updatePgpById.mockResolvedValue({ ok: true, affectedRows: 1 });
    pgpKeyService.validatePublicKey.mockResolvedValue({
      publicKey: "PUBLIC",
      fingerprint: "ABCDEF",
    });

    const result = await service.setPgp({
      ownerEmail: " Owner@Example.com ",
      alias: "Sales@Example.com",
      publicKey: "raw-key",
      hideSubject: true,
    });

    expect(result).toEqual({
      ok: true,
      updated: true,
      alias: "sales@example.com",
      pgp: {
        configured: true,
        enabled: true,
        hide_subject: true,
        fingerprint: "ABCDEF",
        public_key: "PUBLIC",
      },
    });
    expect(pgpKeyService.validatePublicKey).toHaveBeenCalledWith("raw-key");
    expect(aliasRepository.getByAddress).toHaveBeenCalledWith(
      "sales@example.com",
      connection,
      { forUpdate: true },
    );
    expect(aliasRepository.updatePgpById).toHaveBeenCalledWith(
      5,
      {
        publicKey: "PUBLIC",
        fingerprint: "ABCDEF",
        enabled: true,
        hideSubject: true,
      },
      connection,
    );
  });

  it("rejects enabling PGP when no key is stored", async () => {
    const { service, aliasRepository } = createService();
    aliasRepository.getByAddress.mockResolvedValue({
      id: 5,
      address: "sales@example.com",
      goto: "owner@example.com",
      active: 1,
      pgp_public_key: null,
      pgp_fingerprint: null,
      pgp_enabled: 0,
      pgp_hide_subject: 0,
    });

    try {
      await service.patchPgp({
        ownerEmail: "owner@example.com",
        alias: "sales@example.com",
        enabled: true,
      });
      throw new Error("expected patchPgp to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PublicHttpException);
      expect((error as PublicHttpException).getStatus()).toBe(400);
      expect((error as PublicHttpException).getResponse()).toEqual({
        error: "invalid_params",
        field: "enabled",
        reason: "pgp_key_required",
      });
    }

    expect(aliasRepository.updatePgpById).not.toHaveBeenCalled();
  });

  it("rejects aliases owned by another API owner", async () => {
    const { service, aliasRepository, pgpKeyService } = createService();
    aliasRepository.getByAddress.mockResolvedValue({
      id: 5,
      address: "sales@example.com",
      goto: "other@example.com",
      active: 1,
    });
    pgpKeyService.validatePublicKey.mockResolvedValue({
      publicKey: "PUBLIC",
      fingerprint: "ABCDEF",
    });

    await expect(
      service.setPgp({
        ownerEmail: "owner@example.com",
        alias: "sales@example.com",
        publicKey: "raw-key",
      }),
    ).rejects.toThrow(PublicHttpException);

    expect(aliasRepository.updatePgpById).not.toHaveBeenCalled();
  });

  it("clears stored PGP settings", async () => {
    const { service, aliasRepository, connection } = createService();
    aliasRepository.getByAddress.mockResolvedValue({
      id: 5,
      address: "sales@example.com",
      goto: "owner@example.com",
      active: 1,
    });
    aliasRepository.clearPgpById.mockResolvedValue({ ok: true, affectedRows: 1 });

    const result = await service.deletePgp({
      ownerEmail: "owner@example.com",
      alias: "sales@example.com",
    });

    expect(result.pgp).toEqual({
      configured: false,
      enabled: false,
      hide_subject: false,
      fingerprint: null,
      public_key: null,
    });
    expect(aliasRepository.clearPgpById).toHaveBeenCalledWith(5, connection);
  });
});
