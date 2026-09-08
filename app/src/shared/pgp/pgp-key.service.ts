import { Injectable } from "@nestjs/common";
import {
  createMessage,
  encrypt,
  readKey,
  type PublicKey,
} from "openpgp";

import { PublicHttpException } from "../errors/public-http.exception.js";
import { MAX_PGP_PUBLIC_KEY_LENGTH } from "./pgp-key.dto.js";

export interface ValidatedPgpPublicKey {
  publicKey: string;
  fingerprint: string;
}

const RE_PRIVATE_KEY_ARMOR = /-----BEGIN PGP (?:PRIVATE|SECRET) KEY BLOCK-----/i;
const RE_PUBLIC_KEY_ARMOR = /-----BEGIN PGP PUBLIC KEY BLOCK-----/i;

@Injectable()
export class PgpKeyService {
  async validatePublicKey(raw: unknown): Promise<ValidatedPgpPublicKey> {
    if (typeof raw !== "string") {
      this.throwInvalid("public_key_must_be_string");
    }

    const armored = raw.trim();
    if (!armored) {
      this.throwInvalid("public_key_required");
    }

    if (Buffer.byteLength(armored, "utf8") > MAX_PGP_PUBLIC_KEY_LENGTH) {
      this.throwInvalid("public_key_too_large");
    }

    if (RE_PRIVATE_KEY_ARMOR.test(armored)) {
      this.throwInvalid("private_key_not_allowed");
    }

    if (!RE_PUBLIC_KEY_ARMOR.test(armored)) {
      this.throwInvalid("public_key_armor_required");
    }

    let publicKey: PublicKey;
    try {
      const parsed = await readKey({ armoredKey: armored });
      if (parsed.isPrivate()) {
        this.throwInvalid("private_key_not_allowed");
      }

      publicKey = parsed.toPublic();
      await publicKey.getEncryptionKey();
      await this.assertCanEncrypt(publicKey);
    } catch (error) {
      if (error instanceof PublicHttpException) {
        throw error;
      }
      this.throwInvalid("invalid_or_unusable_public_key");
    }

    const fingerprint = publicKey.getFingerprint().trim().toUpperCase();
    if (!fingerprint || fingerprint.length > 64) {
      this.throwInvalid("invalid_fingerprint");
    }

    return {
      publicKey: publicKey.armor(),
      fingerprint,
    };
  }

  private async assertCanEncrypt(publicKey: PublicKey): Promise<void> {
    const message = await createMessage({
      text: "mail-forwarding-api pgp validation",
    });

    await encrypt({
      message,
      encryptionKeys: publicKey,
      format: "armored",
    });
  }

  private throwInvalid(reason: string): never {
    throw new PublicHttpException(400, {
      error: "invalid_params",
      field: "public_key",
      reason,
    });
  }
}
