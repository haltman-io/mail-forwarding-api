"use strict";

const { buildEmailSubject } = require("../../src/lib/email-subject-template");

describe("email-subject-template", () => {
  test("supports ${placeholder} syntax", () => {
    const subject = buildEmailSubject({
      template: "${code} is your verification code | ${host} / alias:create",
      host: "mail.thc.org",
      code: "123456",
    });

    expect(subject).toBe("123456 is your verification code | mail.thc.org / alias:create");
  });

  test("supports {placeholder} syntax", () => {
    const subject = buildEmailSubject({
      template: "{code} is your verification code | {host} / alias:create",
      host: "mail.thc.org",
      code: "123456",
    });

    expect(subject).toBe("123456 is your verification code | mail.thc.org / alias:create");
  });

  test("treats plain template text as action from .env", () => {
    const subject = buildEmailSubject({
      template: "alias:create",
      host: "mail.thc.org",
      code: "123456",
    });

    expect(subject).toBe("123456 is your verification code | mail.thc.org / alias:create");
  });

  test("uses default format when template is empty", () => {
    const subject = buildEmailSubject({
      template: "",
      host: "mail.thc.org",
      code: "123456",
    });

    expect(subject).toBe("123456 is your verification code | mail.thc.org");
  });
});
