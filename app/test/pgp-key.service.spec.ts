import { generateKey } from "openpgp";

import { PgpKeyService } from "../src/shared/pgp/pgp-key.service.js";
import { PublicHttpException } from "../src/shared/errors/public-http.exception.js";

describe("PgpKeyService", () => {
  const service = new PgpKeyService();
  let publicKey = "";
  let privateKey = "";

  beforeAll(async () => {
    const generated = await generateKey({
      type: "curve25519",
      userIDs: [{ name: "PGP Test", email: "pgp-test@example.com" }],
    });

    publicKey = generated.publicKey;
    privateKey = generated.privateKey;
  }, 30_000);

  it("accepts an armored public key and returns normalized metadata", async () => {
    const result = await service.validatePublicKey(publicKey);

    expect(result.publicKey).toContain("-----BEGIN PGP PUBLIC KEY BLOCK-----");
    expect(result.publicKey).toContain("-----END PGP PUBLIC KEY BLOCK-----");
    expect(result.fingerprint).toMatch(/^[A-F0-9]{40,64}$/);
  });

  it("rejects private keys", async () => {
    try {
      await service.validatePublicKey(privateKey);
      throw new Error("expected validatePublicKey to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(PublicHttpException);
      expect((error as PublicHttpException).getStatus()).toBe(400);
      expect((error as PublicHttpException).getResponse()).toEqual({
        error: "invalid_params",
        field: "public_key",
        reason: "private_key_not_allowed",
      });
    }
  });

  it("rejects non-PGP text", async () => {
    await expect(service.validatePublicKey("not a public key")).rejects.toThrow(
      PublicHttpException,
    );
  });
});
