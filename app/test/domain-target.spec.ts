import { INVALID_TARGET_ERROR, normalizeDomainTarget } from "../src/shared/validation/domain-target.js";

describe("normalizeDomainTarget", () => {
  it("normalizes valid domains", () => {
    expect(normalizeDomainTarget("  Example.COM. ")).toEqual({
      ok: true,
      value: "example.com",
    });
  });

  it("rejects invalid inputs", () => {
    expect(normalizeDomainTarget("https://example.com")).toEqual({
      ok: false,
      error: INVALID_TARGET_ERROR,
    });
    expect(normalizeDomainTarget("127.0.0.1")).toEqual({
      ok: false,
      error: INVALID_TARGET_ERROR,
    });
  });
});
