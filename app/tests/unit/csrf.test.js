"use strict";

const {
  deriveCsrfToken,
  isCsrfTokenValid,
} = require("../../src/lib/csrf");

describe("csrf", () => {
  test("derives a stable token for the same session family", () => {
    const tokenA = deriveCsrfToken("family-123");
    const tokenB = deriveCsrfToken("family-123");

    expect(tokenA).toBe(tokenB);
  });

  test("validates only the matching token", () => {
    const token = deriveCsrfToken("family-123");

    expect(isCsrfTokenValid("family-123", token)).toBe(true);
    expect(isCsrfTokenValid("family-456", token)).toBe(false);
  });
});
