import { AdminDnsRequestsController } from "../src/modules/admin/dns-requests/admin-dns-requests.controller.js";

describe("AdminDnsRequestsController", () => {
  it("returns a paginated dns request list", async () => {
    const controller = new AdminDnsRequestsController({
      listDnsRequests: async () => ({
        items: [{ id: 17, target: "example.com", type: "EMAIL" }],
        pagination: { total: 1, limit: 50, offset: 0 },
      }),
    } as never);

    const result = await controller.listDnsRequests({});

    expect(result).toEqual({
      items: [{ id: 17, target: "example.com", type: "EMAIL" }],
      pagination: { total: 1, limit: 50, offset: 0 },
    });
  });

  it("returns created dns request", async () => {
    const controller = new AdminDnsRequestsController({
      createDnsRequest: async () => ({
        ok: true,
        created: true,
        item: { id: 18, target: "example.com", type: "UI" },
      }),
    } as never);

    const result = await controller.createDnsRequest({
      target: "example.com",
      type: "UI",
      status: "PENDING",
      expires_at: new Date(),
    });

    expect(result).toEqual({
      ok: true,
      created: true,
      item: { id: 18, target: "example.com", type: "UI" },
    });
  });
});
