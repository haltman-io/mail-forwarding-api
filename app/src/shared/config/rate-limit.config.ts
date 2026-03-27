import { registerAs } from "@nestjs/config";

import { getInt, getString } from "./env.utils.js";

export const rateLimitConfig = registerAs("rateLimit", () => ({
  redisPrefix: getString("REDIS_RATE_LIMIT_PREFIX", "rl:").trim() || "rl:",
  globalPerMin: getInt("RL_GLOBAL_PER_MIN", 300),

  subscribeSlowDelayAfter: getInt("SD_SUBSCRIBE_DELAY_AFTER", 10),
  subscribeSlowDelayStepMs: getInt("SD_SUBSCRIBE_DELAY_STEP_MS", 250),
  subscribePer10MinPerIp: getInt("RL_SUBSCRIBE_PER_10MIN_PER_IP", 60),
  subscribePerHourPerTo: getInt("RL_SUBSCRIBE_PER_HOUR_PER_TO", 6),
  subscribePerHourPerAlias: getInt("RL_SUBSCRIBE_PER_HOUR_PER_ALIAS", 20),

  confirmPer10MinPerIp: getInt("RL_CONFIRM_PER_10MIN_PER_IP", 120),
  confirmPer10MinPerToken: getInt("RL_CONFIRM_PER_10MIN_PER_TOKEN", 10),

  unsubscribeSlowDelayAfter: getInt("SD_UNSUBSCRIBE_DELAY_AFTER", 8),
  unsubscribeSlowDelayStepMs: getInt("SD_UNSUBSCRIBE_DELAY_STEP_MS", 300),
  unsubscribePer10MinPerIp: getInt("RL_UNSUBSCRIBE_PER_10MIN_PER_IP", 40),
  unsubscribePerHourPerAddress: getInt("RL_UNSUBSCRIBE_PER_HOUR_PER_ADDRESS", 6),

  checkdnsPer10MinPerTarget: getInt("RL_CHECKDNS_PER_10MIN_PER_TARGET", 30),
  requestUiPerMinPerIp: getInt("RL_REQUEST_UI_PER_MIN_PER_IP", 60),
  requestUiPer10MinPerTarget: getInt("RL_REQUEST_UI_PER_10MIN_PER_TARGET", 20),
  requestEmailPer10MinPerIp: getInt("RL_REQUEST_EMAIL_PER_10MIN_PER_IP", 20),
  requestEmailPerHourPerTarget: getInt("RL_REQUEST_EMAIL_PER_HOUR_PER_TARGET", 3),

  credentialsCreatePerHourPerIp: getInt("RL_CREDENTIALS_CREATE_PER_HOUR_PER_IP", 10),
  credentialsCreatePerHourPerEmail: getInt("RL_CREDENTIALS_CREATE_PER_HOUR_PER_EMAIL", 3),
  credentialsConfirmPer10MinPerIp: getInt("RL_CREDENTIALS_CONFIRM_PER_10MIN_PER_IP", 60),
  credentialsConfirmPer10MinPerToken: getInt("RL_CREDENTIALS_CONFIRM_PER_10MIN_PER_TOKEN", 5),

  authPasswordResetRequestPerHourPerIp: getInt(
    "RL_AUTH_PASSWORD_RESET_REQUEST_PER_HOUR_PER_IP",
    10,
  ),
  authPasswordResetRequestPerHourPerEmail: getInt(
    "RL_AUTH_PASSWORD_RESET_REQUEST_PER_HOUR_PER_EMAIL",
    3,
  ),
  authPasswordResetConfirmPer10MinPerIp: getInt(
    "RL_AUTH_PASSWORD_RESET_CONFIRM_PER_10MIN_PER_IP",
    30,
  ),
  authPasswordResetConfirmPer10MinPerToken: getInt(
    "RL_AUTH_PASSWORD_RESET_CONFIRM_PER_10MIN_PER_TOKEN",
    10,
  ),
  authLoginFailPer15MinPerIp: getInt("RL_ADMIN_LOGIN_FAIL_PER_15MIN_PER_IP", 12),
  authLoginFailPerHourPerIdentifier: getInt("RL_ADMIN_LOGIN_FAIL_PER_HOUR_PER_EMAIL", 6),
  authLoginFailPer6HoursPerIdentifierIp: getInt("RL_ADMIN_LOGIN_FAIL_PER_6H_PER_EMAIL_IP", 3),
  authLoginFailPer5MinPerIdentifierIp: getInt("RL_ADMIN_LOGIN_FAIL_PER_5MIN_PER_EMAIL_IP", 2),

  aliasListPerMinPerKey: getInt("RL_ALIAS_LIST_PER_MIN_PER_KEY", 600),
  aliasCreatePerMinPerKey: getInt("RL_ALIAS_CREATE_PER_MIN_PER_KEY", 120),
  aliasDeletePerMinPerKey: getInt("RL_ALIAS_DELETE_PER_MIN_PER_KEY", 120),
}));
