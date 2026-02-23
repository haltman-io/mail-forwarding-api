jest.mock("../../src/config", () => ({
  config: {
    defaultAliasDomain: "example.com",
    emailConfirmationTtlMinutes: 10,
  },
}));

jest.mock("../../src/repositories/domain-repository", () => ({
  domainRepository: {
    getActiveByName: jest.fn(),
    existsActive: jest.fn(),
  },
}));

jest.mock("../../src/lib/ban-policy", () => ({
  domainSuffixes: jest.fn((domain) => [String(domain || "")]),
  findActiveDomainBan: jest.fn(),
  findActiveEmailOrDomainBan: jest.fn(),
  findActiveNameBan: jest.fn(),
}));

jest.mock("../../src/repositories/alias-repository", () => ({
  aliasRepository: {
    existsByAddress: jest.fn(),
    existsReservedHandle: jest.fn(),
  },
}));

jest.mock("../../src/services/email-confirmation-service", () => ({
  sendEmailConfirmation: jest.fn(),
}));

jest.mock("../../src/lib/logger", () => ({
  logError: jest.fn(),
}));

const { subscribeAction } = require("../../src/controllers/forward/subscribe-controller");
const { domainRepository } = require("../../src/repositories/domain-repository");
const { aliasRepository } = require("../../src/repositories/alias-repository");
const { sendEmailConfirmation } = require("../../src/services/email-confirmation-service");
const {
  findActiveDomainBan,
  findActiveEmailOrDomainBan,
  findActiveNameBan,
} = require("../../src/lib/ban-policy");

function createRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    get: jest.fn(),
  };
}

describe("forward subscribe controller", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("rejects subscribe with explicit address when name is banned", async () => {
    findActiveNameBan.mockResolvedValue({
      ban_type: "name",
      ban_value: "admin1",
      reason: "abuse",
      banned_at: "2026-02-23T00:00:00.000Z",
    });

    const req = {
      ip: "::ffff:127.0.0.1",
      query: {
        address: "admin1@example.com",
        to: "owner@pm.me",
      },
      headers: {},
      get: jest.fn().mockReturnValue(""),
    };
    const res = createRes();

    await subscribeAction(req, res);

    expect(findActiveNameBan).toHaveBeenCalledWith("admin1");
    expect(sendEmailConfirmation).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "banned",
      ban: {
        ban_type: "name",
        ban_value: "admin1",
        reason: "abuse",
        banned_at: "2026-02-23T00:00:00.000Z",
      },
    });
  });

  test("rejects subscribe when alias handle is reserved in alias_handle", async () => {
    domainRepository.getActiveByName.mockResolvedValue({ id: 1, name: "example.com", active: 1 });
    findActiveNameBan.mockResolvedValue(null);
    findActiveDomainBan.mockResolvedValue(null);
    findActiveEmailOrDomainBan.mockResolvedValue(null);
    aliasRepository.existsByAddress.mockResolvedValue(false);
    aliasRepository.existsReservedHandle.mockResolvedValue(true);

    const req = {
      ip: "::ffff:127.0.0.1",
      query: {
        name: "admin1",
        domain: "example.com",
        to: "owner@pm.me",
      },
      headers: {},
      get: jest.fn().mockReturnValue(""),
    };
    const res = createRes();

    await subscribeAction(req, res);

    expect(aliasRepository.existsReservedHandle).toHaveBeenCalledWith("admin1");
    expect(sendEmailConfirmation).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      error: "alias_taken",
      address: "admin1@example.com",
    });
  });
});
