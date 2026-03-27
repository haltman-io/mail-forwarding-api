import { AdminController } from "../src/modules/admin/admin.controller.js";
import { createMockResponse } from "./http-mocks.js";

describe("AdminController", () => {
  it("returns the protected admin message", async () => {
    const controller = new AdminController({ getAdminMe: async () => ({}) } as never);
    const response = createMockResponse();

    await controller.getProtected(response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      message: "This user is an administrator",
    });
  });
});
