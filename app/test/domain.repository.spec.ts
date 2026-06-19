import { jest } from "@jest/globals";

import { DomainRepository } from "../src/modules/domains/domain.repository.js";

describe("DomainRepository domain gates", () => {
  function createRepository(rows: unknown[] = []) {
    const database = {
      query: jest.fn(() => Promise.resolve(rows)),
    };

    return {
      repository: new DomainRepository(database as never),
      database,
    };
  }

  it("lists only visible EMAIL-valid domains for the public domain endpoint", async () => {
    const { repository, database } = createRepository([{ name: "example.com" }]);

    const result = await repository.listVisibleEmailValidNames();

    expect(result).toEqual(["example.com"]);
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining("active_mx = 1"));
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining("visible = 1"));
  });

  it("checks EMAIL validity separately from the admin active gate", async () => {
    const { repository, database } = createRepository([
      {
        id: 7,
        name: "example.com",
        active: 1,
        active_mx: 1,
        active_ui: 0,
        visible: 0,
      },
    ]);

    await repository.getEmailValidByName("example.com");

    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("active_mx = 1"),
      ["example.com"],
    );
  });

  it("checks managed destination domains by admin active state only", async () => {
    const { repository, database } = createRepository([]);

    await repository.getAdminActiveByName("example.com");

    const sql = (database.query.mock.calls[0] as unknown[] | undefined)?.[0];
    expect(String(sql)).toContain("active = 1");
    expect(String(sql)).not.toContain("active_mx = 1");
    expect(String(sql)).not.toContain("visible = 1");
  });

  it("counts only visible EMAIL-valid domains for public stats", async () => {
    const { repository, database } = createRepository([{ total: "3" }]);

    await expect(repository.countVisibleEmailValid()).resolves.toBe(3);

    expect(database.query).toHaveBeenCalledWith(expect.stringContaining("active_mx = 1"));
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining("visible = 1"));
  });
});
