const path = require("path");

describe("admin-password-service", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  test("hashes with Argon2id and verifies via argon2.verify flow", async () => {
    process.env.ADMIN_AUTH_ARGON2_TIME_COST = "2";
    process.env.ADMIN_AUTH_ARGON2_MEMORY_COST = "32768";
    process.env.ADMIN_AUTH_ARGON2_PARALLELISM = "1";
    process.env.ADMIN_AUTH_ARGON2_HASH_LENGTH = "32";
    process.env.ADMIN_AUTH_ARGON2_SALT_LENGTH = "16";

    jest.resetModules();
    const service = require(path.join("..", "..", "src", "services", "admin-password-service"));

    const hash = await service.hashAdminPassword("S3nh@SuperSegura!");
    expect(hash.startsWith("$argon2id$")).toBe(true);

    const ok = await service.verifyAdminPassword(hash, "S3nh@SuperSegura!");
    const nok = await service.verifyAdminPassword(hash, "senha-errada");

    expect(ok).toBe(true);
    expect(nok).toBe(false);
  });
});
