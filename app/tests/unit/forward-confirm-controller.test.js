jest.mock("../../src/repositories/email-confirmations-repository", () => ({
  emailConfirmationsRepository: {
    getPendingByTokenHash: jest.fn(),
    markConfirmedById: jest.fn(),
  },
}));

jest.mock("../../src/repositories/domain-repository", () => ({
  domainRepository: {
    getActiveByName: jest.fn(),
  },
}));

jest.mock("../../src/repositories/alias-repository", () => ({
  aliasRepository: {
    getByAddress: jest.fn(),
    existsReservedHandle: jest.fn(),
    createIfNotExists: jest.fn(),
    deleteByAddress: jest.fn(),
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

const { confirmAction } = require("../../src/controllers/forward/confirm-controller");
const { emailConfirmationsRepository } = require("../../src/repositories/email-confirmations-repository");
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

describe("forward confirm controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("rejects confirmation create when destination email/domain is banned", async () => {
    emailConfirmationsRepository.getPendingByTokenHash.mockResolvedValue({
      id: 78,
      email: "owner@blocked-domain.com",
      intent: "subscribe",
      alias_name: "admin1",
      alias_domain: "example.com",
    });
    emailConfirmationsRepository.markConfirmedById.mockResolvedValue(true);
    domainRepository.getActiveByName.mockResolvedValue({ id: 1, name: "example.com", active: 1 });
    findActiveNameBan.mockResolvedValue(null);
    findActiveDomainBan.mockResolvedValue(null);
    findActiveEmailOrDomainBan.mockResolvedValue({
      ban_type: "domain",
      ban_value: "blocked-domain.com",
      reason: "blocked",
      banned_at: "2026-02-23T00:00:00.000Z",
    });

    const req = {
      query: { token: "123456" },
      headers: {},
    };
    const res = createRes();

    await confirmAction(req, res);

    expect(aliasRepository.createIfNotExists).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      error: "banned",
      ban: {
        ban_type: "domain",
        ban_value: "blocked-domain.com",
        reason: "blocked",
        banned_at: "2026-02-23T00:00:00.000Z",
      },
    });
  });

  test("rejects confirmation create when alias handle becomes reserved", async () => {
    emailConfirmationsRepository.getPendingByTokenHash.mockResolvedValue({
      id: 77,
      email: "owner@pm.me",
      intent: "subscribe",
      alias_name: "admin1",
      alias_domain: "example.com",
    });
    emailConfirmationsRepository.markConfirmedById.mockResolvedValue(true);
    domainRepository.getActiveByName.mockResolvedValue({ id: 1, name: "example.com", active: 1 });
    findActiveNameBan.mockResolvedValue(null);
    findActiveDomainBan.mockResolvedValue(null);
    findActiveEmailOrDomainBan.mockResolvedValue(null);
    aliasRepository.getByAddress.mockResolvedValue(null);
    aliasRepository.existsReservedHandle.mockResolvedValue(true);

    const req = {
      query: { token: "123456" },
      headers: {},
    };
    const res = createRes();

    await confirmAction(req, res);

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
