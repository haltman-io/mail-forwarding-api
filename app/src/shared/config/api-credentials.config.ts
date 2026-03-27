import { registerAs } from "@nestjs/config";

import { getInt, getString } from "./env.utils.js";

export const apiCredentialsConfig = registerAs("apiCredentials", () => ({
  confirmEndpoint: getString("API_CREDENTIALS_CONFIRM_ENDPOINT", "/api/credentials/confirm"),
  emailTtlMinutes: getInt("API_CREDENTIALS_EMAIL_TTL_MINUTES", 15),
  emailResendCooldownSeconds: getInt("API_CREDENTIALS_EMAIL_RESEND_COOLDOWN_SECONDS", 60),
  emailMaxSends: getInt("API_CREDENTIALS_EMAIL_MAX_SENDS", 3),
  emailSubjectTemplate: getString("API_CREDENTIALS_EMAIL_SUBJECT", ""),
  defaultAliasDomain: getString("DEFAULT_ALIAS_DOMAIN", ""),
}));
