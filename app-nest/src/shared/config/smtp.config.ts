import { registerAs } from "@nestjs/config";

import { getBool, getInt, getString } from "./env.utils.js";

export const smtpConfig = registerAs("smtp", () => ({
  host: getString("SMTP_HOST", ""),
  port: getInt("SMTP_PORT", 587),
  secure: getBool("SMTP_SECURE", false),
  authEnabled: getBool("SMTP_AUTH_ENABLED", false),
  user: getString("SMTP_USER", ""),
  pass: getString("SMTP_PASS", ""),
  from: getString("SMTP_FROM", ""),
  heloName: getString("SMTP_HELO_NAME", ""),
  tlsRejectUnauthorized: getBool("SMTP_TLS_REJECT_UNAUTHORIZED", true),
}));
