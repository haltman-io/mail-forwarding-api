jest.mock("../../src/repositories/domain-repository", () => ({
  domainRepository: {
    getActiveByName: jest.fn(),
  },
}));

jest.mock("../../src/repositories/alias-repository", () => ({
  aliasRepository: {
    existsReservedHandle: jest.fn(),
    createIfNotExists: jest.fn(),
  },
}));

jest.mock("../../src/repositories/activity-repository", () => ({
  activityRepository: {
    listByOwner: jest.fn(),
  },
}));

jest.mock("../../src/lib/logger", () => ({
  logError: jest.fn(),
}));

jest.mock("../../src/lib/ban-policy", () => ({
  findActiveDomainBan: jest.fn(),
  findActiveEmailOrDomainBan: jest.fn(),
  findActiveNameBan: jest.fn(),
}));

const { createAlias } = require("../../src/controllers/api/alias-controller");
const { domainRepository } = require("../../src/repositories/domain-repository");
const { aliasRepository } = require("../../src/repositories/alias-repository");
const {
  findActiveDomainBan,
  findActiveEmailOrDomainBan,
  findActiveNameBan,
} = require("../../src/lib/ban-policy");

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe("api alias controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("rejects alias creation when alias handle name is banned", async () => {
    findActiveNameBan.mockResolvedValue({
      ban_type: "name",
      ban_value: "admin1",
      reason: "reserved",
      banned_at: "2026-02-23T00:00:00.000Z",
    });

    const req = {
      body: { alias_handle: "admin1", alias_domain: "example.com" },
      query: {},
      api_token: { owner_email: "owner@pm.me" },
      headers: {},
    };
    const res = createRes();

    await createAlias(req, res);

    expect(findActiveNameBan).toHaveBeenCalledWith("admin1");
    expect(aliasRepository.createIfNotExists).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "banned",
      ban: {
        ban_type: "name",
        ban_value: "admin1",
        reason: "reserved",
        banned_at: "2026-02-23T00:00:00.000Z",
      },
    });
  });

  test("rejects alias creation when handle is reserved in alias_handle", async () => {
    domainRepository.getActiveByName.mockResolvedValue({ id: 11, name: "example.com", active: 1 });
    findActiveNameBan.mockResolvedValue(null);
    findActiveDomainBan.mockResolvedValue(null);
    findActiveEmailOrDomainBan.mockResolvedValue(null);
    aliasRepository.existsReservedHandle.mockResolvedValue(true);

    const req = {
      body: { alias_handle: "admin1", alias_domain: "example.com" },
      query: {},
      api_token: { owner_email: "owner@pm.me" },
      headers: {},
    };
    const res = createRes();

    await createAlias(req, res);

    expect(aliasRepository.existsReservedHandle).toHaveBeenCalledWith("admin1");
    expect(aliasRepository.createIfNotExists).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      error: "alias_taken",
      address: "admin1@example.com",
    });
  });
});
