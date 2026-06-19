import { jest } from "@jest/globals";

import { AliasMetricsRepository } from "../src/modules/stats/alias-metrics.repository.js";

describe("AliasMetricsRepository", () => {
  it("counts public aliases against visible EMAIL-valid domains", async () => {
    const database = {
      query: jest.fn(() => Promise.resolve([{ total: 42 }])),
    };
    const repository = new AliasMetricsRepository(database as never);

    await expect(repository.countVisibleEmailValid()).resolves.toBe(42);

    const sql = (database.query.mock.calls[0] as unknown[] | undefined)?.[0];
    expect(String(sql)).toContain("d.active_mx = 1");
    expect(String(sql)).toContain("d.visible = 1");
    expect(String(sql)).toContain("SUBSTRING_INDEX(a.address, '@', -1)");
    expect(String(sql)).toContain("alias_handle_disabled_domain");
  });
});
