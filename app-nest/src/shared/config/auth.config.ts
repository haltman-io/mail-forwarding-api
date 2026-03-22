import { registerAs } from "@nestjs/config";

import { getBool, getInt, getJsonObject, getString } from "./env.utils.js";

function normalizeSameSite(value: string): "lax" | "strict" | "none" {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "strict") return "strict";
  if (normalized === "none") return "none";
  return "lax";
}

export const authConfig = registerAs("auth", () => ({
  verifyEmailEndpoint: getString("AUTH_VERIFY_EMAIL_ENDPOINT", "/auth/verify-email")
    .trim()
    .replace(/^\/?/, "/"),
  verifyEmailTtlMinutes: getInt("AUTH_REGISTER_TTL_MINUTES", 15),
  verifyEmailResendCooldownSeconds: getInt("AUTH_REGISTER_RESEND_COOLDOWN_SECONDS", 60),
  verifyEmailMaxSends: getInt("AUTH_REGISTER_MAX_SENDS", 3),
  verifyEmailSubjectTemplate: getString("AUTH_REGISTER_EMAIL_SUBJECT", "Verify your email"),
  passwordResetTtlMinutes: getInt("PASSWORD_RESET_TTL_MINUTES", 15),
  passwordResetResendCooldownSeconds: getInt("PASSWORD_RESET_RESEND_COOLDOWN_SECONDS", 60),
  passwordResetMaxSends: getInt("PASSWORD_RESET_MAX_SENDS", 3),
  passwordResetEmailSubject: getString("PASSWORD_RESET_EMAIL_SUBJECT", "Password reset"),
  refreshTtlDays: getInt("AUTH_REFRESH_TTL_DAYS", 30),
  maxActiveSessionFamilies: getInt("AUTH_MAX_ACTIVE_SESSION_FAMILIES", 5),
  cookieSameSite: normalizeSameSite(getString("AUTH_COOKIE_SAME_SITE", "lax")),
  csrfSecret: getString("AUTH_CSRF_SECRET", ""),
  jwtAccessPrivateKey: getString("JWT_ACCESS_PRIVATE_KEY", ""),
  jwtAccessKid: getString("JWT_ACCESS_KID", ""),
  jwtAccessVerificationKeys: getJsonObject("JWT_ACCESS_VERIFY_KEYS", {}),
  jwtAccessIssuer: getString("JWT_ACCESS_ISSUER", "mail-forwarding-api"),
  jwtAccessAudience: getString("JWT_ACCESS_AUDIENCE", "mail-forwarding-web"),
  jwtAccessTtlSeconds: getInt("JWT_ACCESS_TTL_SECONDS", 600),
  jwtAccessClockSkewSeconds: getInt("JWT_ACCESS_CLOCK_SKEW_SECONDS", 60),
  dummyPasswordHash: getString("ADMIN_AUTH_DUMMY_PASSWORD_HASH", ""),
  argon2TimeCost: getInt("ADMIN_AUTH_ARGON2_TIME_COST", 4),
  argon2MemoryCost: getInt("ADMIN_AUTH_ARGON2_MEMORY_COST", 128 * 1024),
  argon2Parallelism: getInt("ADMIN_AUTH_ARGON2_PARALLELISM", 1),
  argon2HashLength: getInt("ADMIN_AUTH_ARGON2_HASH_LENGTH", 32),
  argon2SaltLength: getInt("ADMIN_AUTH_ARGON2_SALT_LENGTH", 16),
  adminLoginEmailEnabled: getBool("ADMIN_LOGIN_EMAIL_ENABLED", true),
  adminLoginEmailSubject: getString(
    "ADMIN_LOGIN_EMAIL_SUBJECT",
    "Security alert: admin login | {host}",
  ),
}));
