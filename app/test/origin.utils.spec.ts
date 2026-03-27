import { normalizeOriginInput } from "../src/shared/tenancy/origin.utils.js";

describe("normalizeOriginInput", () => {
  it("normalizes valid origins", () => {
    expect(normalizeOriginInput("https://Tenant.Example.com/path?query=1")).toBe(
      "https://tenant.example.com",
    );
  });

  it("rejects null and wildcard-like values", () => {
    expect(normalizeOriginInput("null")).toBeNull();
    expect(normalizeOriginInput("*")).toBeNull();
    expect(normalizeOriginInput("file:///tmp/test")).toBeNull();
  });
});
