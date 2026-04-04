import { jest } from "@jest/globals";

import { AdminBansService } from "../src/modules/admin/bans/admin-bans.service.js";

function createService() {
  const database = {
    withTransaction: jest.fn(
      async (work: (connection: object) => Promise<unknown>) => work({ tx: true }),
    ),
  };
  const adminBansRepository = {
    createBan: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    getById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  };
  const adminAliasesRepository = {
    disableMatchingActiveAliasesForBan: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  };

  const service = new AdminBansService(
    database as never,
    adminBansRepository as never,
    adminAliasesRepository as never,
  );

  return {
    service,
    database,
    adminBansRepository,
    adminAliasesRepository,
  };
}

describe("AdminBansService", () => {
  it("creates a ban and disables matching aliases when requested", async () => {
    const { service, adminBansRepository, adminAliasesRepository } = createService();

    adminBansRepository.createBan.mockResolvedValue({
      ok: true,
      insertId: 22,
    });
    adminBansRepository.getById.mockResolvedValue({
      id: 22,
      ban_type: "email",
      ban_value: "spammer@example.com",
      reason: "spam",
      created_at: "2026-04-04T12:00:00.000Z",
      expires_at: null,
      revoked_at: null,
      revoked_reason: null,
    });
    adminAliasesRepository.disableMatchingActiveAliasesForBan.mockResolvedValue(2);

    const result = await service.createBan({
      ban_type: "EMAIL",
      ban_value: "Spammer@Example.com",
      reason: "spam",
      disable_matching_aliases: true,
    });

    expect(adminBansRepository.createBan).toHaveBeenCalledWith(
      {
        banType: "email",
        banValue: "spammer@example.com",
        reason: "spam",
        expiresAt: null,
      },
      expect.any(Object),
    );
    expect(adminAliasesRepository.disableMatchingActiveAliasesForBan).toHaveBeenCalledWith(
      {
        banType: "email",
        banValue: "spammer@example.com",
      },
      expect.any(Object),
    );
    expect(result).toEqual({
      ok: true,
      created: true,
      item: {
        id: 22,
        ban_type: "email",
        ban_value: "spammer@example.com",
        reason: "spam",
        created_at: "2026-04-04T12:00:00.000Z",
        expires_at: null,
        revoked_at: null,
        revoked_reason: null,
        active: true,
      },
      disabled_aliases: 2,
      message: "Ban created. Also, 2 matching aliases were disabled.",
    });
  });

  it("defaults disable_matching_aliases to false", async () => {
    const { service, adminBansRepository, adminAliasesRepository } = createService();

    adminBansRepository.createBan.mockResolvedValue({
      ok: true,
      insertId: 23,
    });
    adminBansRepository.getById.mockResolvedValue({
      id: 23,
      ban_type: "ip",
      ban_value: "203.0.113.10",
      reason: null,
      created_at: "2026-04-04T12:00:00.000Z",
      expires_at: null,
      revoked_at: null,
      revoked_reason: null,
    });

    const result = await service.createBan({
      ban_type: "ip",
      ban_value: "203.0.113.10",
    });

    expect(adminAliasesRepository.disableMatchingActiveAliasesForBan).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      created: true,
      item: {
        id: 23,
        ban_type: "ip",
        ban_value: "203.0.113.10",
        reason: null,
        created_at: "2026-04-04T12:00:00.000Z",
        expires_at: null,
        revoked_at: null,
        revoked_reason: null,
        active: true,
      },
      disabled_aliases: 0,
      message: "Ban created.",
    });
  });

  it("rejects automatic alias disabling for ip bans", async () => {
    const { service, adminBansRepository, adminAliasesRepository } = createService();

    await expect(
      service.createBan({
        ban_type: "ip",
        ban_value: "203.0.113.10",
        disable_matching_aliases: true,
      }),
    ).rejects.toMatchObject({
      response: {
        error: "invalid_params",
        field: "disable_matching_aliases",
        reason: "not_supported_for_ip_bans",
      },
    });

    expect(adminBansRepository.createBan).not.toHaveBeenCalled();
    expect(adminAliasesRepository.disableMatchingActiveAliasesForBan).not.toHaveBeenCalled();
  });
});
