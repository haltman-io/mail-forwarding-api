import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import argon2 from "argon2";

const FALLBACK_DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=131072,t=4,p=1$L/mffIBj9C0gzyzOnmkUHQ$FgGLHMi1bdENEMchXbgdisn0+oOmolSiP//2841TDBM";

export const MIN_PASSWORD_LEN = 8;
export const MAX_PASSWORD_LEN = 256;

type AuthSettings = {
  dummyPasswordHash: string;
  argon2TimeCost: number;
  argon2MemoryCost: number;
  argon2Parallelism: number;
  argon2HashLength: number;
  argon2SaltLength: number;
};

function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const intNum = Math.floor(num);
  if (intNum < min) return min;
  if (intNum > max) return max;
  return intNum;
}

@Injectable()
export class PasswordService {
  constructor(private readonly configService: ConfigService) {}

  assertPlainPassword(value: unknown): string {
    if (typeof value !== "string") throw new Error("invalid_password");
    if (value.length < MIN_PASSWORD_LEN || value.length > MAX_PASSWORD_LEN) {
      throw new Error("invalid_password");
    }
    return value;
  }

  async hashPassword(plainPassword: string): Promise<string> {
    const normalizedPassword = this.assertPlainPassword(plainPassword);
    return argon2.hash(normalizedPassword, this.getArgon2idOptions());
  }

  async verifyPassword(storedHash: string, plainPassword: string): Promise<boolean> {
    if (typeof storedHash !== "string" || !storedHash.trim()) return false;
    const normalizedPassword = this.assertPlainPassword(plainPassword);
    return argon2.verify(storedHash, normalizedPassword);
  }

  async consumeSlowVerify(rawPassword: unknown): Promise<void> {
    const password = this.normalizePasswordForSlowVerify(rawPassword);
    try {
      await this.verifyPassword(this.getDummyHash(), password);
    } catch {
      // Intentionally ignored to normalize login failure cost.
    }
  }

  private getArgon2idOptions(): argon2.Options & { type: typeof argon2.argon2id } {
    const settings = this.configService.getOrThrow<AuthSettings>("auth");
    return {
      type: argon2.argon2id,
      timeCost: clampInt(settings.argon2TimeCost, 2, 12, 4),
      memoryCost: clampInt(
        settings.argon2MemoryCost,
        32 * 1024,
        1024 * 1024,
        128 * 1024,
      ),
      parallelism: clampInt(settings.argon2Parallelism, 1, 4, 1),
      hashLength: clampInt(settings.argon2HashLength, 16, 64, 32),
    };
  }

  private getDummyHash(): string {
    const settings = this.configService.getOrThrow<AuthSettings>("auth");
    const configured = String(settings.dummyPasswordHash || "").trim();
    return configured || FALLBACK_DUMMY_PASSWORD_HASH;
  }

  private normalizePasswordForSlowVerify(raw: unknown): string {
    if (
      typeof raw === "string" &&
      raw.length >= MIN_PASSWORD_LEN &&
      raw.length <= MAX_PASSWORD_LEN
    ) {
      return raw;
    }
    return "invalid-password-placeholder";
  }
}
