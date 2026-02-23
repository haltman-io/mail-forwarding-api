const { parseOptionalBoolAsInt } = require("../../src/controllers/admin/helpers");

describe("admin helpers", () => {
  test("parseOptionalBoolAsInt accepts numeric 0/1", () => {
    expect(parseOptionalBoolAsInt(0)).toEqual({ ok: true, value: 0 });
    expect(parseOptionalBoolAsInt(1)).toEqual({ ok: true, value: 1 });
  });

  test("parseOptionalBoolAsInt accepts boolean values", () => {
    expect(parseOptionalBoolAsInt(false)).toEqual({ ok: true, value: 0 });
    expect(parseOptionalBoolAsInt(true)).toEqual({ ok: true, value: 1 });
  });

  test("parseOptionalBoolAsInt accepts string values", () => {
    expect(parseOptionalBoolAsInt("0")).toEqual({ ok: true, value: 0 });
    expect(parseOptionalBoolAsInt("1")).toEqual({ ok: true, value: 1 });
    expect(parseOptionalBoolAsInt("off")).toEqual({ ok: true, value: 0 });
    expect(parseOptionalBoolAsInt("on")).toEqual({ ok: true, value: 1 });
  });

  test("parseOptionalBoolAsInt keeps invalid values rejected", () => {
    expect(parseOptionalBoolAsInt(null)).toEqual({ ok: false });
    expect(parseOptionalBoolAsInt(2)).toEqual({ ok: false });
    expect(parseOptionalBoolAsInt("")).toEqual({ ok: false });
    expect(parseOptionalBoolAsInt("maybe")).toEqual({ ok: false });
  });
});
