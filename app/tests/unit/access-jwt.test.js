"use strict";

const { mintAccessJwt, verifyAccessJwt } = require("../../src/lib/access-jwt");

describe("access-jwt", () => {
  test("mints and verifies an EdDSA access JWT", () => {
    const minted = mintAccessJwt({
      userId: 7,
      sessionFamilyId: "family-123",
    });

    const verified = verifyAccessJwt(minted.token);

    expect(verified.claims.sub).toBe("7");
    expect(verified.claims.sid).toBe("family-123");
    expect(verified.header.alg).toBe("EdDSA");
  });

  test("rejects tokens with a disallowed algorithm header", () => {
    const minted = mintAccessJwt({
      userId: 7,
      sessionFamilyId: "family-123",
    });

    const parts = minted.token.split(".");
    const badHeader = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT", kid: "test-access-key" }),
      "utf8"
    ).toString("base64url");

    expect(() => verifyAccessJwt(`${badHeader}.${parts[1]}.${parts[2]}`)).toThrow(
      "invalid_token_algorithm"
    );
  });
});
