import { registerAs } from "@nestjs/config";

import { getInt, getString } from "./env.utils.js";

export const forwardingConfig = registerAs("forwarding", () => ({
  confirmEndpoint: getString("EMAIL_CONFIRM_ENDPOINT", "/api/forward/confirm"),
  emailConfirmationTtlMinutes: getInt("EMAIL_CONFIRMATION_TTL_MINUTES", 10),
  emailConfirmationResendCooldownSeconds: getInt("EMAIL_CONFIRMATION_RESEND_COOLDOWN_SECONDS", 60),
  emailSubject: getString("EMAIL_CONFIRMATION_SUBJECT", ""),
  emailSubjectSubscribe: getString("EMAIL_CONFIRMATION_SUBJECT_SUBSCRIBE", ""),
  emailSubjectUnsubscribe: getString("EMAIL_CONFIRMATION_SUBJECT_UNSUBSCRIBE", ""),
}));
