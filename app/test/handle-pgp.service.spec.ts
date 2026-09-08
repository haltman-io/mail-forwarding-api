import { jest } from "@jest/globals";

import { HandlePgpService } from "../src/modules/handle/services/handle-pgp.service.js";
import { PublicHttpException } from "../src/shared/errors/public-http.exception.js";

function createTxConnection() {
  return { tx: true };
}

function createService() {
  const connection = createTxConnection();
  const handleRepository = {
    getActiveByHandle: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
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

  const service = new HandlePgpService(
    handleRepository as never,
    databaseService as never,
    pgpKeyService as never,
  );

  return { service, handleRepository, databaseService, pgpKeyService, connection };
}

describe("HandlePgpService", () => {
  it("validates ownership and stores normalized PGP settings", async () => {
    const { service, handleRepository, pgpKeyService, connection } = createService();
    handleRepository.getActiveByHandle.mockResolvedValue({
      id: 9,
      handle: "contact",
      address: "owner@example.com",
      active: 1,
    });
    handleRepository.updatePgpById.mockResolvedValue({ ok: true, affectedRows: 1 });
    pgpKeyService.validatePublicKey.mockResolvedValue({
      publicKey: "PUBLIC",
      fingerprint: "ABCDEF",
    });

    const result = await service.setPgp({
      ownerEmail: " Owner@Example.com ",
      handle: "Contact",
      publicKey: "raw-key",
      enabled: false,
      hideSubject: true,
    });

    expect(result).toEqual({
      ok: true,
      updated: true,
      handle: "contact",
      pgp: {
        configured: true,
        enabled: false,
        hide_subject: true,
        fingerprint: "ABCDEF",
        public_key: "PUBLIC",
      },
    });
    expect(handleRepository.getActiveByHandle).toHaveBeenCalledWith(
      "contact",
      connection,
      { forUpdate: true },
    );
    expect(handleRepository.updatePgpById).toHaveBeenCalledWith(
      9,
      {
        publicKey: "PUBLIC",
        fingerprint: "ABCDEF",
        enabled: false,
        hideSubject: true,
      },
      connection,
    );
  });

  it("returns current PGP settings for the owner", async () => {
    const { service, handleRepository } = createService();
    handleRepository.getActiveByHandle.mockResolvedValue({
      id: 9,
      handle: "contact",
      address: "owner@example.com",
      active: 1,
      pgp_public_key: "PUBLIC",
      pgp_fingerprint: "ABCDEF",
      pgp_enabled: 1,
      pgp_hide_subject: 0,
    });

    await expect(
      service.getPgp({
        ownerEmail: "owner@example.com",
        handle: "contact",
      }),
    ).resolves.toEqual({
      ok: true,
      handle: "contact",
      pgp: {
        configured: true,
        enabled: true,
        hide_subject: false,
        fingerprint: "ABCDEF",
        public_key: "PUBLIC",
      },
    });
  });

  it("rejects handles owned by another API owner", async () => {
    const { service, handleRepository, pgpKeyService } = createService();
    handleRepository.getActiveByHandle.mockResolvedValue({
      id: 9,
      handle: "contact",
      address: "other@example.com",
      active: 1,
    });
    pgpKeyService.validatePublicKey.mockResolvedValue({
      publicKey: "PUBLIC",
      fingerprint: "ABCDEF",
    });

    await expect(
      service.setPgp({
        ownerEmail: "owner@example.com",
        handle: "contact",
        publicKey: "raw-key",
      }),
    ).rejects.toThrow(PublicHttpException);

    expect(handleRepository.updatePgpById).not.toHaveBeenCalled();
  });

  it("clears stored PGP settings", async () => {
    const { service, handleRepository, connection } = createService();
    handleRepository.getActiveByHandle.mockResolvedValue({
      id: 9,
      handle: "contact",
      address: "owner@example.com",
      active: 1,
    });
    handleRepository.clearPgpById.mockResolvedValue({ ok: true, affectedRows: 1 });

    const result = await service.deletePgp({
      ownerEmail: "owner@example.com",
      handle: "contact",
    });

    expect(result.pgp).toEqual({
      configured: false,
      enabled: false,
      hide_subject: false,
      fingerprint: null,
      public_key: null,
    });
    expect(handleRepository.clearPgpById).toHaveBeenCalledWith(9, connection);
  });
});
