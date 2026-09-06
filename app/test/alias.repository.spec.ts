import { jest } from "@jest/globals";

import { AliasRepository } from "../src/modules/api/repositories/alias.repository.js";

describe("AliasRepository", () => {
  function createRepository() {
    const database = {
      query: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      withTransaction: jest.fn(
        async (work: (connection: object) => Promise<unknown>) => work({ tx: true }),
      ),
    };

    const repository = new AliasRepository(database as never);

    return { repository, database };
  }

  describe("findActiveByLocalPart", () => {
    it("returns empty array for empty input", async () => {
      const { repository, database } = createRepository();

      const result = await repository.findActiveByLocalPart("");

      expect(result).toEqual([]);
      expect(database.query).not.toHaveBeenCalled();
    });

    it("queries active aliases matching the local part", async () => {
      const { repository, database } = createRepository();

      const mockRows = [
        { id: 1, address: "joao@dominio1.com", goto: "joao@gmail.com", active: 1 },
      ];
      database.query.mockResolvedValue(mockRows);

      const result = await repository.findActiveByLocalPart("Joao");

      expect(result).toEqual(mockRows);
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining("SUBSTRING_INDEX(a.address, '@', 1) = ?"),
        ["joao"],
      );
    });

    it("applies FOR UPDATE when forUpdate option is true", async () => {
      const { repository, database } = createRepository();

      database.query.mockResolvedValue([]);

      await repository.findActiveByLocalPart("joao", undefined, { forUpdate: true });

      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining("FOR UPDATE"),
        ["joao"],
      );
    });
  });

  describe("deleteActiveByIdsAndOwner", () => {
    it("returns 0 when aliasIds or ownerEmail is empty", async () => {
      const { repository, database } = createRepository();

      expect(await repository.deleteActiveByIdsAndOwner([], "owner@gmail.com")).toBe(0);
      expect(await repository.deleteActiveByIdsAndOwner([1], "")).toBe(0);
      expect(database.query).not.toHaveBeenCalled();
    });

    it("deletes only active aliases by id and owner", async () => {
      const { repository, database } = createRepository();

      database.query.mockResolvedValue({ affectedRows: 2 });

      const affected = await repository.deleteActiveByIdsAndOwner([1, 2], "Joao@Gmail.com ");

      expect(affected).toBe(2);
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM alias"),
        [1, 2, "joao@gmail.com"],
      );
      expect(String(database.query.mock.calls[0]?.[0])).toContain("id IN (?, ?)");
      expect(String(database.query.mock.calls[0]?.[0])).toContain("active = 1");
      expect(String(database.query.mock.calls[0]?.[0])).toContain("LOWER(TRIM(goto)) = ?");
    });
  });
});
