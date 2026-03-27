import { jest } from "@jest/globals";

import { AdminAliasesService, AdminHandlesService } from "../src/modules/admin/admin-aliases-handles.service.js";
import { AdminBansService, AdminApiTokensService } from "../src/modules/admin/admin-bans-api-tokens.service.js";
import { AdminDomainsService } from "../src/modules/admin/admin-session-domains.service.js";

describe("Admin delete services", () => {
  it("physically deletes domains and returns the existing row snapshot", async () => {
    type DomainRow = { id: number; name: string; active: number };
    const getById = jest.fn<(id: number) => Promise<DomainRow | null>>();
    const deleteById = jest.fn<(id: number) => Promise<boolean>>();
    const adminDomainsRepository = { getById, deleteById };
    getById.mockResolvedValueOnce({ id: 4, name: "example.com", active: 1 });
    deleteById.mockResolvedValue(true);
    const service = new AdminDomainsService(adminDomainsRepository as never, {} as never);

    const result = await service.deleteDomain(4);

    expect(adminDomainsRepository.deleteById).toHaveBeenCalledWith(4);
    expect(result).toEqual({
      ok: true,
      deleted: true,
      item: { id: 4, name: "example.com", active: 1 },
    });
  });

  it("physically deletes aliases and handles", async () => {
    type AliasRow = { id: number; address: string; goto: string; active: number };
    type HandleRow = { id: number; handle: string; address: string; active: number };
    const aliasGetById = jest.fn<(id: number) => Promise<AliasRow | null>>();
    const aliasDeleteById = jest.fn<(id: number) => Promise<boolean>>();
    const handleGetById = jest.fn<(id: number) => Promise<HandleRow | null>>();
    const handleDeleteById = jest.fn<(id: number) => Promise<boolean>>();
    const adminAliasesRepository = {
      getById: aliasGetById,
      deleteById: aliasDeleteById,
    };
    const adminHandlesRepository = {
      getById: handleGetById,
      deleteById: handleDeleteById,
    };
    aliasGetById.mockResolvedValueOnce({
      id: 11,
      address: "sales@example.com",
      goto: "owner@example.com",
      active: 1,
    });
    aliasDeleteById.mockResolvedValue(true);
    handleGetById.mockResolvedValueOnce({
      id: 12,
      handle: "sales",
      address: "owner@example.com",
      active: 1,
    });
    handleDeleteById.mockResolvedValue(true);

    const aliasesService = new AdminAliasesService(
      {} as never,
      adminAliasesRepository as never,
      {} as never,
      {} as never,
    );
    const handlesService = new AdminHandlesService(
      {} as never,
      adminHandlesRepository as never,
      {} as never,
    );

    const aliasResult = await aliasesService.deleteAlias(11);
    const handleResult = await handlesService.deleteHandle(12);

    expect(aliasDeleteById).toHaveBeenCalledWith(11);
    expect(handleDeleteById).toHaveBeenCalledWith(12);
    expect(aliasResult).toEqual({
      ok: true,
      deleted: true,
      item: {
        id: 11,
        address: "sales@example.com",
        goto: "owner@example.com",
        active: 1,
      },
    });
    expect(handleResult).toEqual({
      ok: true,
      deleted: true,
      item: {
        id: 12,
        handle: "sales",
        address: "owner@example.com",
        active: 1,
      },
    });
  });

  it("physically deletes bans and API tokens", async () => {
    type BanRow = {
      id: number;
      ban_type: string;
      ban_value: string;
      reason: string | null;
      created_at: string;
      expires_at: string | null;
      revoked_at: string | null;
      revoked_reason: string | null;
    };
    type ApiTokenRow = {
      id: number;
      owner_email: string;
      status: string;
      created_at: string;
      expires_at: string | null;
      revoked_at: string | null;
      revoked_reason: string | null;
      created_ip: string | null;
      user_agent: string | null;
      last_used_at: string | null;
    };
    const banGetById = jest.fn<(id: number) => Promise<BanRow | null>>();
    const banDeleteById = jest.fn<(id: number) => Promise<boolean>>();
    const tokenGetById = jest.fn<(id: number) => Promise<ApiTokenRow | null>>();
    const tokenDeleteById = jest.fn<(id: number) => Promise<boolean>>();
    const adminBansRepository = {
      getById: banGetById,
      deleteById: banDeleteById,
    };
    const adminApiTokensRepository = {
      getById: tokenGetById,
      deleteById: tokenDeleteById,
    };
    banGetById.mockResolvedValueOnce({
      id: 8,
      ban_type: "email",
      ban_value: "blocked@example.com",
      reason: "spam",
      created_at: "2026-03-01T00:00:00.000Z",
      expires_at: null,
      revoked_at: null,
      revoked_reason: null,
    });
    banDeleteById.mockResolvedValue(true);
    tokenGetById.mockResolvedValueOnce({
      id: 9,
      owner_email: "owner@example.com",
      status: "active",
      created_at: "2026-03-01T00:00:00.000Z",
      expires_at: "2099-03-01T00:00:00.000Z",
      revoked_at: null,
      revoked_reason: null,
      created_ip: "203.0.113.10",
      user_agent: "Jest",
      last_used_at: null,
    });
    tokenDeleteById.mockResolvedValue(true);

    const bansService = new AdminBansService(adminBansRepository as never);
    const apiTokensService = new AdminApiTokensService(adminApiTokensRepository as never);

    const banResult = await bansService.deleteBan(8);
    const apiTokenResult = await apiTokensService.deleteApiToken(9);

    expect(banDeleteById).toHaveBeenCalledWith(8);
    expect(tokenDeleteById).toHaveBeenCalledWith(9);
    expect(banResult).toMatchObject({
      ok: true,
      deleted: true,
      item: {
        id: 8,
        ban_value: "blocked@example.com",
        active: true,
      },
    });
    expect(apiTokenResult).toMatchObject({
      ok: true,
      deleted: true,
      item: {
        id: 9,
        owner_email: "owner@example.com",
        active: true,
      },
    });
  });
});
