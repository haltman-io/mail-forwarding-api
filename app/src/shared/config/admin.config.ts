import { registerAs } from "@nestjs/config";

import { getBool, getString } from "./env.utils.js";

export const adminConfig = registerAs("admin", () => ({
  creationNotificationEnabled: getBool("ADMIN_CREATION_NOTIFICATION_ENABLED", true),
  userChangeEmailEnabled: getBool("ADMIN_USER_CHANGE_EMAIL_ENABLED", true),
  userChangeEmailSubject: getString(
    "ADMIN_USER_CHANGE_EMAIL_SUBJECT",
    "Security alert: admin account changed | {host}",
  ),
}));
