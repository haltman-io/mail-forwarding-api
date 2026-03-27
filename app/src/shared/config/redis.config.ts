import { registerAs } from "@nestjs/config";

import { getInt, getString } from "./env.utils.js";

export const redisConfig = registerAs("redis", () => ({
  url: getString("REDIS_URL", "").trim(),
  connectTimeoutMs: getInt("REDIS_CONNECT_TIMEOUT_MS", 5000)
}));
