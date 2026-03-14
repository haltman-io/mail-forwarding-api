"use strict";

const {
  buildCookieOptions,
  parseCookiesHeader,
  shouldUseSecureCookies,
} = require("../../src/lib/auth-cookies");

describe("auth-cookies", () => {
  test("parses cookie headers", () => {
    expect(parseCookiesHeader("__Host-access=a; __Host-refresh=b")).toEqual({
      "__Host-access": "a",
      "__Host-refresh": "b",
    });
  });

  test("uses secure cookies only in prod env", () => {
    expect(shouldUseSecureCookies("prod")).toBe(true);
    expect(shouldUseSecureCookies("test")).toBe(false);
    expect(buildCookieOptions({ maxAgeMs: 1000, envName: "test" })).toEqual(
      expect.objectContaining({
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        path: "/",
        maxAge: 1000,
      })
    );
  });

  test("supports SameSite=None when explicitly requested", () => {
    expect(buildCookieOptions({ maxAgeMs: 1000, envName: "prod", sameSite: "none" })).toEqual(
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
        maxAge: 1000,
      })
    );
  });
});
