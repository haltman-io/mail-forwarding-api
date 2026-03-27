import { AdminDnsRequestsController } from "../src/modules/admin/admin-dns-requests.controller.js";
import { createMockResponse } from "./http-mocks.js";

describe("AdminDnsRequestsController", () => {
  it("returns a paginated dns request list", async () => {
    const controller = new AdminDnsRequestsController({
      listDnsRequests: async () => ({
        items: [{ id: 17, target: "example.com", type: "EMAIL" }],
        pagination: { total: 1, limit: 50, offset: 0 },
      }),
    } as never);
    const response = createMockResponse();

    await controller.listDnsRequests({}, response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      items: [{ id: 17, target: "example.com", type: "EMAIL" }],
      pagination: { total: 1, limit: 50, offset: 0 },
    });
  });

  it("returns 201 when creating a dns request", async () => {
    const controller = new AdminDnsRequestsController({
      createDnsRequest: async () => ({
        ok: true,
        created: true,
        item: { id: 18, target: "example.com", type: "UI" },
      }),
    } as never);
    const response = createMockResponse();

    await controller.createDnsRequest(
      {
        target: "example.com",
        type: "UI",
        status: "PENDING",
        expires_at: new Date(),
      },
      response,
    );

    expect(response.statusCode).toBe(201);
    expect(response.body).toEqual({
      ok: true,
      created: true,
      item: { id: 18, target: "example.com", type: "UI" },
    });
});
});
