jest.mock("../../src/repositories/db", () => ({
  query: jest.fn(),
  withTx: jest.fn(),
}));

const { aliasRepository } = require("../../src/repositories/alias-repository");
const { query, withTx } = require("../../src/repositories/db");

describe("aliasRepository (schema v2)", () => {
  test("createAlias inserts without domain_id", async () => {
    query.mockResolvedValue({ affectedRows: 1, insertId: 7 });

    const result = await aliasRepository.createAlias({
      address: "alpha@example.com",
      goto: "owner@example.com",
      domainId: 10,
      active: true,
    });

    expect(result).toEqual({ ok: true, insertId: 7 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO alias/i);
    expect(sql).not.toMatch(/domain_id/i);
    expect(params).toEqual(["alpha@example.com", "owner@example.com", 1]);
  });

  test("createAlias rejects invalid domainId when provided", async () => {
    await expect(
      aliasRepository.createAlias({
        address: "alpha@example.com",
        goto: "owner@example.com",
        domainId: 0,
        active: true,
      })
    ).rejects.toThrow("invalid_domain_id");
  });

  test("getByAddress selects domain_id via join", async () => {
    query.mockResolvedValue([
      {
        id: 1,
        address: "alpha@example.com",
        goto: "owner@example.com",
        active: 1,
        domain_id: 42,
        created: "2026-01-01 00:00:00",
        modified: "2026-01-01 00:00:00",
      },
    ]);

    const row = await aliasRepository.getByAddress("alpha@example.com");

    expect(row.domain_id).toBe(42);
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/LEFT JOIN domain/i);
    expect(sql).toMatch(/AS domain_id/i);
  });

  test("listByGoto selects domain_id via join", async () => {
    query.mockResolvedValue([]);

    await aliasRepository.listByGoto("owner@example.com");

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/LEFT JOIN domain/i);
    expect(sql).toMatch(/AS domain_id/i);
    expect(params).toEqual(["owner@example.com"]);
  });

  test("createIfNotExists selects with join and inserts without domain_id", async () => {
    const conn = {
      query: jest.fn(),
    };
    conn.query.mockResolvedValueOnce([]);
    conn.query.mockResolvedValueOnce({ affectedRows: 1, insertId: 5 });

    withTx.mockImplementation(async (fn) => fn(conn));

    const result = await aliasRepository.createIfNotExists({
      address: "beta@example.com",
      goto: "owner@example.com",
      domainId: 2,
      active: 1,
    });

    expect(result).toEqual({ ok: true, created: true, insertId: 5 });
    expect(conn.query).toHaveBeenCalledTimes(2);
    const selectSql = conn.query.mock.calls[0][0];
    const insertSql = conn.query.mock.calls[1][0];
    expect(selectSql).toMatch(/LEFT JOIN domain/i);
    expect(selectSql).toMatch(/AS domain_id/i);
    expect(insertSql).not.toMatch(/domain_id/i);
  });
});
