"use strict";

const {
  normalizeUsername,
  parseIdentifier,
} = require("../../src/lib/auth-identifiers");

describe("auth-identifiers", () => {
  test("normalizes valid usernames", () => {
    expect(normalizeUsername(" New_User-1 ")).toBe("new_user-1");
  });

  test("resolves email and username identifiers", () => {
    expect(parseIdentifier("User@example.com")).toEqual({
      type: "email",
      value: "user@example.com",
    });
    expect(parseIdentifier("new_user")).toEqual({
      type: "username",
      value: "new_user",
    });
  });
});
