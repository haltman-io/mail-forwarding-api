import { jest } from "@jest/globals";

import { AdminAliasesRepository } from "../src/modules/admin/aliases/admin-aliases.repository.js";

describe("AdminAliasesRepository.disableMatchingActiveAliasesForBan", () => {
  it("disables aliases by exact destination email", async () => {
    const database = {
      query: jest.fn(async () => ({ affectedRows: 2 })),
    };
    const repository = new AdminAliasesRepository(database as never);

    const result = await repository.disableMatchingActiveAliasesForBan({
      banType: "email",
      banValue: "spammer@example.com",
    });

    expect(result).toBe(2);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("AND goto = ?"),
      ["spammer@example.com"],
    );
  });

  it("disables aliases by destination domain suffix", async () => {
    const database = {
      query: jest.fn(async () => ({ affectedRows: 3 })),
    };
    const repository = new AdminAliasesRepository(database as never);

    const result = await repository.disableMatchingActiveAliasesForBan({
      banType: "domain",
      banValue: "example.com",
    });

    expect(result).toBe(3);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "AND (SUBSTRING_INDEX(goto, '@', -1) = ? OR SUBSTRING_INDEX(goto, '@', -1) LIKE CONCAT('%.', ?))",
      ),
      ["example.com", "example.com"],
    );
  });

  it("disables aliases by local-part name", async () => {
    const database = {
      query: jest.fn(async () => ({ affectedRows: 1 })),
    };
    const repository = new AdminAliasesRepository(database as never);

    const result = await repository.disableMatchingActiveAliasesForBan({
      banType: "name",
      banValue: "spammer",
    });

    expect(result).toBe(1);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("AND SUBSTRING_INDEX(address, '@', 1) = ?"),
      ["spammer"],
    );
  });
});
