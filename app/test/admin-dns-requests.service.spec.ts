import { jest } from "@jest/globals";

import { AdminDnsRequestsService } from "../src/modules/admin/dns-requests/admin-dns-requests.service.js";
import { PublicHttpException } from "../src/shared/errors/public-http.exception.js";

describe("AdminDnsRequestsService", () => {
  function createService() {
    const adminDnsRequestsRepository: any = {
      listAll: jest.fn(),
      countAll: jest.fn(),
      getById: jest.fn(),
      getByTargetType: jest.fn(),
      createDnsRequest: jest.fn(),
      updateById: jest.fn(),
      deleteById: jest.fn(),
    };

    return {
      service: new AdminDnsRequestsService(adminDnsRequestsRepository as never),
      adminDnsRequestsRepository,
    };
  }

  it("rejects invalid dns targets on creation", async () => {
    const { service } = createService();

    await expect(
      service.createDnsRequest({
        target: "https://example.com",
        type: "EMAIL",
        status: "ACTIVE",
        expires_at: new Date("2026-04-01T00:00:00.000Z"),
      }),
    ).rejects.toMatchObject({
      response: {
        error: "invalid_params",
        field: "target",
      },
    });
  });

  it("serializes json input and returns parsed json in the response item", async () => {
    const { service, adminDnsRequestsRepository } = createService();

    adminDnsRequestsRepository.getByTargetType.mockResolvedValue(null);
    adminDnsRequestsRepository.createDnsRequest.mockResolvedValue({
      ok: true,
      insertId: 171,
    });
    adminDnsRequestsRepository.getById.mockResolvedValue({
      id: 171,
      target: "hash.example.com",
      type: "EMAIL",
      status: "ACTIVE",
      created_at: "2026-03-11T13:20:18.000Z",
      updated_at: "2026-03-11T13:20:19.000Z",
      activated_at: "2026-03-11T14:20:18.000Z",
      last_checked_at: "2026-03-11T14:20:18.000Z",
      next_check_at: "2026-03-11T14:21:18.000Z",
      last_check_result_json: "{\"ok\":true,\"missing\":[]}",
      fail_reason: null,
      expires_at: "2026-03-12T14:20:18.000Z",
    });

    const result = await service.createDnsRequest({
      target: "hash.example.com",
      type: "EMAIL",
      status: "ACTIVE",
      last_check_result_json: { ok: true, missing: [] },
      expires_at: new Date("2026-03-12T14:20:18.000Z"),
    });

    expect(adminDnsRequestsRepository.createDnsRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        target: "hash.example.com",
        type: "EMAIL",
        status: "ACTIVE",
        lastCheckResultJson: "{\"ok\":true,\"missing\":[]}",
      }),
    );
    expect(result).toEqual({
      ok: true,
      created: true,
      item: expect.objectContaining({
        id: 171,
        last_check_result_json: { ok: true, missing: [] },
      }),
    });
  });

  it("rejects empty patches", async () => {
    const { service, adminDnsRequestsRepository } = createService();

    adminDnsRequestsRepository.getById.mockResolvedValue({
      id: 171,
      target: "hash.example.com",
      type: "EMAIL",
      status: "ACTIVE",
      created_at: "2026-03-11T13:20:18.000Z",
      updated_at: "2026-03-11T13:20:19.000Z",
      activated_at: null,
      last_checked_at: null,
      next_check_at: null,
      last_check_result_json: null,
      fail_reason: null,
      expires_at: "2026-03-12T14:20:18.000Z",
    });

    await expect(service.updateDnsRequest(171, {})).rejects.toMatchObject({
      response: {
        error: "invalid_params",
        reason: "empty_patch",
      },
    });
  });

  it("maps not found rows to dns_request_not_found", async () => {
    const { service, adminDnsRequestsRepository } = createService();

    adminDnsRequestsRepository.getById.mockResolvedValue(null);

    try {
      await service.getDnsRequestById(999);
      fail("expected getDnsRequestById to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PublicHttpException);
      expect((error as PublicHttpException).getResponse()).toEqual({
        error: "dns_request_not_found",
        id: 999,
      });
    }
  });
});
