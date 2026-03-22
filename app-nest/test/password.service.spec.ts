import { jest } from "@jest/globals";
import argon2 from "argon2";

import { PasswordService } from "../src/modules/auth/services/password.service.js";

type AuthSettings = {
  dummyPasswordHash: string;
  argon2TimeCost: number;
  argon2MemoryCost: number;
  argon2Parallelism: number;
  argon2HashLength: number;
  argon2SaltLength: number;
};

const baseAuthSettings: AuthSettings = {
  dummyPasswordHash: "",
  argon2TimeCost: 2,
  argon2MemoryCost: 32 * 1024,
  argon2Parallelism: 1,
  argon2HashLength: 32,
  argon2SaltLength: 16,
};

function createService(overrides: Partial<AuthSettings> = {}): PasswordService {
  const configService = {
    getOrThrow: jest.fn().mockReturnValue({
      ...baseAuthSettings,
      ...overrides,
    }),
  };

  return new PasswordService(configService as never);
}

describe("PasswordService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("hashes and verifies passwords with argon2id", async () => {
    const service = createService();

    const hash = await service.hashPassword("CorrectHorseBatteryStaple1");

    expect(hash).toContain("$argon2id$");
    await expect(
      service.verifyPassword(hash, "CorrectHorseBatteryStaple1"),
    ).resolves.toBe(true);
    await expect(service.verifyPassword(hash, "WrongPassword123")).resolves.toBe(
      false,
    );
  });

  it("consumes the dummy canary hash even when the supplied password is invalid", async () => {
    const dummyPasswordHash = await argon2.hash("canary-password", {
      type: argon2.argon2id,
      timeCost: 2,
      memoryCost: 32 * 1024,
      parallelism: 1,
      hashLength: 32,
    });
    const service = createService({ dummyPasswordHash });
    const verifySpy = jest.spyOn(argon2, "verify").mockResolvedValue(false);

    await service.consumeSlowVerify("short");

    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(verifySpy).toHaveBeenCalledWith(
      dummyPasswordHash,
      "invalid-password-placeholder",
    );
  });
});
