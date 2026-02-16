const {
  isValidLocalPart,
  isValidDomain,
  parseMailbox,
  MAX_LOCAL_PART_LENGTH,
} = require("../../src/lib/mailbox-validation");

describe("mailbox-validation", () => {
  test("accepts underscore and hyphen in local-part", () => {
    expect(isValidLocalPart("user_name-01")).toBe(true);
    expect(parseMailbox("user_name-01@example.com")).toEqual({
      email: "user_name-01@example.com",
      local: "user_name-01",
      domain: "example.com",
    });
  });

  test("accepts RFC dot-atom local-part symbols", () => {
    expect(isValidLocalPart("sales+ops")).toBe(true);
    expect(isValidLocalPart("o'hara")).toBe(true);
    expect(parseMailbox("sales+ops@example.com")).toEqual({
      email: "sales+ops@example.com",
      local: "sales+ops",
      domain: "example.com",
    });
  });

  test("normalizes case to lowercase", () => {
    expect(parseMailbox("User_Name@Example.COM")).toEqual({
      email: "user_name@example.com",
      local: "user_name",
      domain: "example.com",
    });
  });

  test("rejects invalid dot-atom local-part forms", () => {
    expect(isValidLocalPart(".abc")).toBe(false);
    expect(isValidLocalPart("abc.")).toBe(false);
    expect(isValidLocalPart("ab..cd")).toBe(false);
  });

  test("enforces local-part max length of 64", () => {
    const ok = "a".repeat(MAX_LOCAL_PART_LENGTH);
    const tooLong = "a".repeat(MAX_LOCAL_PART_LENGTH + 1);
    expect(isValidLocalPart(ok)).toBe(true);
    expect(isValidLocalPart(tooLong)).toBe(false);
  });

  test("enforces strict DNS domain labels", () => {
    expect(isValidDomain("mail.example.com")).toBe(true);
    expect(isValidDomain("bad_domain.example.com")).toBe(false);
    expect(isValidDomain("-bad.example.com")).toBe(false);
    expect(isValidDomain("bad-.example.com")).toBe(false);
  });
});

