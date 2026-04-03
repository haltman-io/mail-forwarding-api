import { AdminController } from "../src/modules/admin/admin.controller.js";

describe("AdminController", () => {
  it("returns the protected admin message", async () => {
    const controller = new AdminController({ getAdminMe: async () => ({}) } as never);

    const result = await controller.getProtected();

    expect(result).toEqual({
      message: "This user is an administrator",
    });
  });
});
