import { jest } from "@jest/globals";

import { HandleService } from "../src/modules/handle/services/handle.service.js";
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
    existsByAddress: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    findActiveByLocalPart: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    deleteActiveByIdsAndOwner: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  };
  const domainRepository = {
    getAdminActiveByName: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  };
  const banPolicyService = {
    findActiveNameBan: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    findActiveEmailOrDomainBan: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  };
  const emailConfirmationService = {
    sendEmailConfirmation: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  };
  const emailConfirmationsRepository = {
    getPendingByTokenHash: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    markConfirmedById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  };
  const databaseService = {
    withTransaction: jest.fn(
      async (work: (connection: object) => Promise<unknown>) => work({ tx: true }),
    ),
  };
  const configService = {
    get: jest.fn(),
  };

  const service = new HandleService(
    handleRepository as never,
    handleDisabledDomainRepository as never,
    aliasRepository as never,
    domainRepository as never,
    banPolicyService as never,
    emailConfirmationService as never,
    emailConfirmationsRepository as never,
    databaseService as never,
    configService as never,
  );

  return {
    service,
    handleRepository,
    handleDisabledDomainRepository,
    aliasRepository,
    domainRepository,
    banPolicyService,
    emailConfirmationService,
    emailConfirmationsRepository,
    databaseService,
  };
}

describe("HandleService", () => {
  describe("subscribe", () => {
    it("allows subscribe when existing aliases belong to the same destination email (Scenario A)", async () => {
      const {
        service,
        handleRepository,
        aliasRepository,
        domainRepository,
        banPolicyService,
        emailConfirmationService,
      } = createService();

      banPolicyService.findActiveNameBan.mockResolvedValue(null);
      banPolicyService.findActiveEmailOrDomainBan.mockResolvedValue(null);
      aliasRepository.existsByAddress.mockResolvedValue(false);
      domainRepository.getAdminActiveByName.mockResolvedValue(null);
      handleRepository.existsByHandle.mockResolvedValue(false);

      aliasRepository.findActiveByLocalPart.mockResolvedValue([
        { id: 1, address: "joao@dominio1.com", goto: "joao@gmail.com", active: 1 },
      ]);
      emailConfirmationService.sendEmailConfirmation.mockResolvedValue({
        sent: true,
        ttl_minutes: 15,
      });

      const response = await service.subscribe({
        handleRaw: "joao",
        toRaw: "joao@gmail.com",
        ipText: "127.0.0.1",
        userAgent: "Jest",
        origin: "https://example.com",
        referer: "https://example.com",
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        ok: true,
        action: "handle_subscribe",
        handle: "joao",
        to: "joao@gmail.com",
      });
      expect(emailConfirmationService.sendEmailConfirmation).toHaveBeenCalled();
    });

    it("rejects subscribe with 409 alias_taken when active alias belongs to another destination (Scenario B)", async () => {
      const {
        service,
        handleRepository,
        aliasRepository,
        domainRepository,
        banPolicyService,
        emailConfirmationService,
      } = createService();

      banPolicyService.findActiveNameBan.mockResolvedValue(null);
      banPolicyService.findActiveEmailOrDomainBan.mockResolvedValue(null);
      aliasRepository.existsByAddress.mockResolvedValue(false);
      domainRepository.getAdminActiveByName.mockResolvedValue(null);
      handleRepository.existsByHandle.mockResolvedValue(false);

      aliasRepository.findActiveByLocalPart.mockResolvedValue([
        { id: 1, address: "joao@dominio1.com", goto: "other@gmail.com", active: 1 },
      ]);

      try {
        await service.subscribe({
          handleRaw: "joao",
          toRaw: "joao@gmail.com",
          ipText: "127.0.0.1",
          userAgent: "Jest",
          origin: "https://example.com",
          referer: "https://example.com",
        });
        throw new Error("expected subscribe to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(PublicHttpException);
        expect((error as PublicHttpException).getStatus()).toBe(409);
        expect((error as PublicHttpException).getResponse()).toEqual({
          ok: false,
          error: "alias_taken",
        });
      }

      expect(emailConfirmationService.sendEmailConfirmation).not.toHaveBeenCalled();
    });
  });

  describe("confirmSubscribe (via confirmAction)", () => {
    const validToken = "123456";

    it("converts active aliases to handle during confirmation (Scenario A)", async () => {
      const {
        service,
        handleRepository,
        aliasRepository,
        banPolicyService,
        emailConfirmationsRepository,
      } = createService();

      const pending = {
        id: 7,
        email: "joao@gmail.com",
        alias_name: "joao",
        intent: "handle_subscribe",
      };

      emailConfirmationsRepository.getPendingByTokenHash
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(pending);

      handleRepository.existsByHandle.mockResolvedValue(false);
      aliasRepository.findActiveByLocalPart.mockResolvedValue([
        { id: 1, address: "joao@dominio1.com", goto: "joao@gmail.com", active: 1 },
        { id: 2, address: "joao@dominio2.com", goto: "joao@gmail.com", active: 1 },
      ]);
      banPolicyService.findActiveNameBan.mockResolvedValue(null);
      banPolicyService.findActiveEmailOrDomainBan.mockResolvedValue(null);
      handleRepository.createHandle.mockResolvedValue({ ok: true, insertId: 5 });
      aliasRepository.deleteActiveByIdsAndOwner.mockResolvedValue(2);
      emailConfirmationsRepository.markConfirmedById.mockResolvedValue(true);

      const response = await service.confirmAction(validToken);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        ok: true,
        created: true,
        handle: "joao",
        goto: "joao@gmail.com",
        converted_aliases: ["joao@dominio1.com", "joao@dominio2.com"],
      });

      expect(handleRepository.createHandle).toHaveBeenCalledWith(
        { handle: "joao", address: "joao@gmail.com", active: 1 },
        expect.anything(),
      );
      expect(handleRepository.existsByHandle).toHaveBeenCalledWith(
        "joao",
        expect.anything(),
        { forUpdate: true },
      );
      expect(aliasRepository.deleteActiveByIdsAndOwner).toHaveBeenCalledWith(
        [1, 2],
        "joao@gmail.com",
        expect.anything(),
      );
      expect(emailConfirmationsRepository.markConfirmedById).toHaveBeenCalledWith(
        7,
        expect.anything(),
      );
    });

    it("rejects confirmation with 409 if an alias owner changed in the meantime (Scenario B)", async () => {
      const {
        service,
        handleRepository,
        aliasRepository,
        emailConfirmationsRepository,
      } = createService();

      const pending = {
        id: 7,
        email: "joao@gmail.com",
        alias_name: "joao",
        intent: "handle_subscribe",
      };

      emailConfirmationsRepository.getPendingByTokenHash
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(pending);

      handleRepository.existsByHandle.mockResolvedValue(false);
      aliasRepository.findActiveByLocalPart.mockResolvedValue([
        { id: 1, address: "joao@dominio1.com", goto: "attacker@gmail.com", active: 1 },
      ]);

      const response = await service.confirmAction(validToken);

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        ok: false,
        error: "alias_taken",
      });

      expect(handleRepository.createHandle).not.toHaveBeenCalled();
      expect(emailConfirmationsRepository.markConfirmedById).not.toHaveBeenCalled();
    });

    it("creates handle without converted_aliases when no active aliases exist (Scenario C)", async () => {
      const {
        service,
        handleRepository,
        aliasRepository,
        banPolicyService,
        emailConfirmationsRepository,
      } = createService();

      const pending = {
        id: 8,
        email: "maria@gmail.com",
        alias_name: "maria",
        intent: "handle_subscribe",
      };

      emailConfirmationsRepository.getPendingByTokenHash
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(pending);

      handleRepository.existsByHandle.mockResolvedValue(false);
      aliasRepository.findActiveByLocalPart.mockResolvedValue([]);
      banPolicyService.findActiveNameBan.mockResolvedValue(null);
      banPolicyService.findActiveEmailOrDomainBan.mockResolvedValue(null);
      handleRepository.createHandle.mockResolvedValue({ ok: true, insertId: 6 });
      emailConfirmationsRepository.markConfirmedById.mockResolvedValue(true);

      const response = await service.confirmAction(validToken);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        ok: true,
        created: true,
        handle: "maria",
        goto: "maria@gmail.com",
      });

      expect(aliasRepository.deleteActiveByIdsAndOwner).not.toHaveBeenCalled();
      expect(emailConfirmationsRepository.markConfirmedById).toHaveBeenCalledWith(
        8,
        expect.anything(),
      );
    });

    it("rejects when converted alias delete count does not match the locked aliases", async () => {
      const {
        service,
        handleRepository,
        aliasRepository,
        banPolicyService,
        emailConfirmationsRepository,
      } = createService();

      const pending = {
        id: 9,
        email: "joao@gmail.com",
        alias_name: "joao",
        intent: "handle_subscribe",
      };

      emailConfirmationsRepository.getPendingByTokenHash
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(pending);

      handleRepository.existsByHandle.mockResolvedValue(false);
      aliasRepository.findActiveByLocalPart.mockResolvedValue([
        { id: 1, address: "joao@dominio1.com", goto: "joao@gmail.com", active: 1 },
        { id: 2, address: "joao@dominio2.com", goto: "joao@gmail.com", active: 1 },
      ]);
      banPolicyService.findActiveNameBan.mockResolvedValue(null);
      banPolicyService.findActiveEmailOrDomainBan.mockResolvedValue(null);
      handleRepository.createHandle.mockResolvedValue({ ok: true, insertId: 5 });
      aliasRepository.deleteActiveByIdsAndOwner.mockResolvedValue(1);

      try {
        await service.confirmAction(validToken);
        throw new Error("expected confirmAction to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(PublicHttpException);
        expect((error as PublicHttpException).getStatus()).toBe(409);
        expect((error as PublicHttpException).getResponse()).toEqual({
          ok: false,
          error: "alias_conversion_state_changed",
        });
      }

      expect(emailConfirmationsRepository.markConfirmedById).not.toHaveBeenCalled();
    });
  });
});
