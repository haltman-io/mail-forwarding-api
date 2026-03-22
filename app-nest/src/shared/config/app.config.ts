import { registerAs } from "@nestjs/config";

import { getInt, getString } from "./env.utils.js";

function resolveEnvName(): string {
  const appEnv = getString("APP_ENV", "").trim().toLowerCase();
  if (appEnv) return appEnv;

  const nodeEnv = getString("NODE_ENV", "").trim().toLowerCase();
  if (nodeEnv === "production") return "prod";
  if (nodeEnv === "staging" || nodeEnv === "homolog" || nodeEnv === "hml") return "hml";
  if (nodeEnv === "development") return "dev";
  return "dev";
}

export const appConfig = registerAs("app", () => ({
  envName: resolveEnvName(),
  host: getString("APP_HOST", "127.0.0.1"),
  port: getInt("APP_PORT", 8080),
  trustProxy: getInt("TRUST_PROXY", 1),
  logLevel: getString("LOG_LEVEL", resolveEnvName() === "dev" ? "debug" : "info"),
  publicUrl: getString("APP_PUBLIC_URL", "")
}));
