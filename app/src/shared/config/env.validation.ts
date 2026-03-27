import { normalizeOriginInput } from "../tenancy/origin.utils.js";
import {
  getString,
  requireNonEmpty,
  requireNonNegativeInt,
  requirePositiveInt,
} from "./env.utils.js";

export function validateEnv(environment: Record<string, unknown>): Record<string, unknown> {
  for (const [key, value] of Object.entries(environment)) {
    if (typeof value === "string" && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  const asRecord = environment as Record<string, string | undefined>;
  const corsAllowedOrigins = String(asRecord.CORS_ALLOWED_ORIGINS ?? "").trim();

  if (
    corsAllowedOrigins
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .includes("*")
  ) {
    throw new Error("invalid_CORS_ALLOWED_ORIGINS_wildcard");
  }

  const publicUrl = getString("APP_PUBLIC_URL", "").trim();
  if (publicUrl && !normalizeOriginInput(publicUrl)) {
    throw new Error("invalid_APP_PUBLIC_URL");
  }

  for (const rawOrigin of corsAllowedOrigins.split(",").map((value) => value.trim()).filter(Boolean)) {
    if (!normalizeOriginInput(rawOrigin)) {
      throw new Error("invalid_CORS_ALLOWED_ORIGINS");
    }
  }

  requirePositiveInt("APP_PORT");
  requireNonNegativeInt("TRUST_PROXY");
  requirePositiveInt("MARIADB_PORT");
  requirePositiveInt("CHECKDNS_HTTP_TIMEOUT_MS");

  requireNonEmpty("MARIADB_HOST");
  requireNonEmpty("MARIADB_USER");
  requireNonEmpty("MARIADB_DATABASE");
  requireNonEmpty("CHECKDNS_BASE_URL");
  requireNonEmpty("CHECKDNS_TOKEN");
  requireNonEmpty("AUTH_CSRF_SECRET");
  requireNonEmpty("JWT_ACCESS_PRIVATE_KEY");
  requireNonEmpty("JWT_ACCESS_KID");
  requireNonEmpty("JWT_ACCESS_VERIFY_KEYS");

  const authCookieSameSite = getString("AUTH_COOKIE_SAME_SITE", "lax").trim().toLowerCase();
  if (!["lax", "strict", "none"].includes(authCookieSameSite)) {
    throw new Error("invalid_AUTH_COOKIE_SAME_SITE");
  }

  return environment;
}
