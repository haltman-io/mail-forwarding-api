"use strict";

/**
 * @fileoverview Environment loading and configuration normalization.
 *
 * This module loads a single .env file (based on APP_ENV/NODE_ENV),
 * normalizes all supported environment variables, and exports a single
 * configuration object used across the application.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const dotenv = require("dotenv");

/**
 * @typedef {Object} AppConfig
 * @property {string} envName
 * @property {string | null} envFile
 * @property {string} appEnv
 * @property {string} appHost
 * @property {number} appPort
 * @property {number} trustProxy
 * @property {string} logLevel
 * @property {string[]} corsAllowedOrigins
 * @property {boolean} corsAllowCredentials
 * @property {string} appPublicUrl
 * @property {string} emailConfirmEndpoint
 * @property {number} emailConfirmationTtlMinutes
 * @property {number} emailConfirmationResendCooldownSeconds
 * @property {number} emailConfirmationTokenLen
 * @property {number} emailConfirmationTokenMinLen
 * @property {number} emailConfirmationTokenMaxLen
 * @property {boolean} emailConfirmStoreIpPacked
 * @property {string} emailConfirmationSubject
 * @property {string} emailConfirmationSubjectSubscribe
 * @property {string} emailConfirmationSubjectUnsubscribe
 * @property {string} smtpHost
 * @property {number} smtpPort
 * @property {boolean} smtpSecure
 * @property {boolean} smtpAuthEnabled
 * @property {string} smtpUser
 * @property {string} smtpPass
 * @property {string} smtpFrom
 * @property {string} smtpHeloName
 * @property {boolean} smtpTlsRejectUnauthorized
 * @property {string} mariadbHost
 * @property {number} mariadbPort
 * @property {string} mariadbUser
 * @property {string} mariadbPassword
 * @property {string} mariadbDatabase
 * @property {string} redisUrl
 * @property {string} redisRateLimitPrefix
 * @property {number} redisConnectTimeoutMs
 * @property {string} checkDnsBaseUrl
 * @property {string} checkDnsToken
 * @property {number} checkDnsHttpTimeoutMs
 * @property {number} rlGlobalPerMin
 * @property {number} sdSubscribeDelayAfter
 * @property {number} sdSubscribeDelayStepMs
 * @property {number} rlSubscribePer10MinPerIp
 * @property {number} rlSubscribePerHourPerTo
 * @property {number} rlSubscribePerHourPerAlias
 * @property {number} rlConfirmPer10MinPerIp
 * @property {number} rlConfirmPer10MinPerToken
 * @property {number} sdUnsubscribeDelayAfter
 * @property {number} sdUnsubscribeDelayStepMs
 * @property {number} rlUnsubscribePer10MinPerIp
 * @property {number} rlUnsubscribePerHourPerAddress
 * @property {number} rlUnsubscribeConfirmPer10MinPerIp
 * @property {number} rlUnsubscribeConfirmPer10MinPerToken
 * @property {number} rlCheckdnsPer10MinPerTarget
 * @property {number} rlRequestUiPerMinPerIp
 * @property {number} rlRequestUiPer10MinPerTarget
 * @property {number} rlRequestEmailPer10MinPerIp
 * @property {number} rlRequestEmailPerHourPerTarget
 * @property {number} rlCredentialsCreatePerHourPerIp
 * @property {number} rlCredentialsCreatePerHourPerEmail
 * @property {number} rlCredentialsConfirmPer10MinPerIp
 * @property {number} rlCredentialsConfirmPer10MinPerToken
 * @property {number} rlAuthRegisterPerHourPerIp
 * @property {number} rlAuthRegisterPerHourPerEmail
 * @property {number} rlAuthRegisterConfirmPer10MinPerIp
 * @property {number} rlAuthRegisterConfirmPer10MinPerToken
 * @property {number} rlAuthPasswordResetRequestPerHourPerIp
 * @property {number} rlAuthPasswordResetRequestPerHourPerEmail
 * @property {number} rlAuthPasswordResetConfirmPer10MinPerIp
 * @property {number} rlAuthPasswordResetConfirmPer10MinPerToken
 * @property {number} rlAdminLoginFailPer15MinPerIp
 * @property {number} rlAdminLoginFailPerHourPerEmail
 * @property {number} rlAdminLoginFailPer6HoursPerEmailIp
 * @property {number} rlAdminLoginFailPer5MinPerEmailIp
 * @property {number} rlAliasListPerMinPerKey
 * @property {number} rlAliasCreatePerMinPerKey
 * @property {number} rlAliasDeletePerMinPerKey
 * @property {string} defaultAliasDomain
 * @property {string} apiCredentialsConfirmEndpoint
 * @property {number} apiCredentialsEmailTtlMinutes
 * @property {number} apiCredentialsEmailResendCooldownSeconds
 * @property {number} apiCredentialsEmailTokenLen
 * @property {number} apiCredentialsEmailMaxSends
 * @property {string} apiCredentialsEmailSubject
 * @property {string} authRegisterConfirmEndpoint
 * @property {number} authRegisterTtlMinutes
 * @property {number} authRegisterResendCooldownSeconds
 * @property {number} authRegisterMaxSends
 * @property {string} authRegisterEmailSubject
 * @property {string} authVerifyEmailEndpoint
 * @property {number} passwordResetTtlMinutes
 * @property {number} passwordResetResendCooldownSeconds
 * @property {number} passwordResetMaxSends
 * @property {string} passwordResetEmailSubject
 * @property {number} authRefreshTtlDays
 * @property {number} authMaxActiveSessionFamilies
 * @property {string} authCsrfSecret
 * @property {string} jwtAccessPrivateKey
 * @property {string} jwtAccessKid
 * @property {Record<string, string>} jwtAccessVerificationKeys
 * @property {string} jwtAccessIssuer
 * @property {string} jwtAccessAudience
 * @property {number} jwtAccessTtlSeconds
 * @property {number} jwtAccessClockSkewSeconds
 * @property {number} adminAuthSessionTtlMinutes
 * @property {number} adminAuthTokenBytes
 * @property {string} adminAuthDummyPasswordHash
 * @property {number} adminAuthArgon2TimeCost
 * @property {number} adminAuthArgon2MemoryCost
 * @property {number} adminAuthArgon2Parallelism
 * @property {number} adminAuthArgon2HashLength
 * @property {number} adminAuthArgon2SaltLength
 * @property {boolean} adminLoginEmailEnabled
 * @property {string} adminLoginEmailSubject
 * @property {boolean} adminUserChangeEmailEnabled
 * @property {string} adminUserChangeEmailSubject
 */

/**
 * Resolve environment name using APP_ENV first, then NODE_ENV.
 * @returns {string}
 */
function resolveEnvName() {
  const appEnv = String(process.env.APP_ENV || "").trim().toLowerCase();
  if (appEnv) return appEnv;

  const nodeEnv = String(process.env.NODE_ENV || "").trim().toLowerCase();
  if (nodeEnv === "production") return "prod";
  if (nodeEnv === "staging" || nodeEnv === "homolog" || nodeEnv === "hml") return "hml";
  if (nodeEnv === "development") return "dev";

  return "dev";
}

/**
 * Load the most appropriate .env file for the resolved environment.
 * @returns {{ envName: string, envFile: string | null }}
 */
function loadDotenv() {
  const envName = resolveEnvName();
  const rootDir = process.cwd();

  const candidateFiles = [
    { envName, filePath: path.join(rootDir, `.env.${envName}`) },
    { envName, filePath: path.join(rootDir, ".env") },
  ];

  if (envName === "dev") {
    candidateFiles.push({ envName: "prod", filePath: path.join(rootDir, ".env.prod") });
  }

  let loadedFile = null;
  let loadedEnvName = envName;

  for (const candidate of candidateFiles) {
    if (fs.existsSync(candidate.filePath)) {
      const result = dotenv.config({ path: candidate.filePath });
      if (result.error) {
        throw result.error;
      }
      loadedFile = candidate.filePath;
      loadedEnvName = candidate.envName;
      break;
    }
  }

  return { envName: loadedEnvName, envFile: loadedFile };
}

/**
 * Normalize a string env var.
 * @param {string} key
 * @param {string} fallback
 * @returns {string}
 */
function getString(key, fallback = "") {
  const value = process.env[key];
  if (value === undefined || value === null) return fallback;
  return String(value);
}

/**
 * Normalize an integer env var.
 * @param {string} key
 * @param {number} fallback
 * @returns {number}
 */
function getInt(key, fallback) {
  const raw = getString(key, "");
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : fallback;
}

/**
 * Normalize a boolean env var.
 * @param {string} key
 * @param {boolean} fallback
 * @returns {boolean}
 */
function getBool(key, fallback = false) {
  const raw = process.env[key];
  if (typeof raw !== "string") return fallback;

  switch (raw.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return fallback;
  }
}

/**
 * Normalize a JSON object env var.
 * @param {string} key
 * @param {Record<string, string>} fallback
 * @returns {Record<string, string>}
 */
function getJsonObject(key, fallback = {}) {
  const raw = getString(key, "").trim();
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;

    const out = {};
    for (const [entryKey, entryValue] of Object.entries(parsed)) {
      out[String(entryKey)] = String(entryValue || "");
    }
    return out;
  } catch (_) {
    return fallback;
  }
}

/**
 * Normalize a comma-separated string list env var.
 * @param {string} key
 * @param {string[]} fallback
 * @returns {string[]}
 */
function getStringList(key, fallback = []) {
  const raw = getString(key, "").trim();
  if (!raw) return fallback;

  return Array.from(
    new Set(
      raw
        .split(",")
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function toPem(value) {
  return String(value || "").replace(/\\n/g, "\n").trim();
}

/**
 * Build the application configuration from environment variables.
 * @param {{ envName: string, envFile: string | null }} meta
 * @returns {AppConfig}
 */
function buildConfig(meta) {
  return {
    envName: meta.envName,
    envFile: meta.envFile,
    appEnv: getString("APP_ENV", meta.envName),
    appHost: getString("APP_HOST", "127.0.0.1"),
    appPort: getInt("APP_PORT", 8080),
    trustProxy: getInt("TRUST_PROXY", 1),
    logLevel: getString("LOG_LEVEL", meta.envName === "dev" ? "debug" : "info"),
    corsAllowedOrigins: getStringList("CORS_ALLOWED_ORIGINS", []),
    corsAllowCredentials: getBool("CORS_ALLOW_CREDENTIALS", true),

    appPublicUrl: getString("APP_PUBLIC_URL", ""),
    emailConfirmEndpoint: getString("EMAIL_CONFIRM_CONFIRM_ENDPOINT", "/forward/confirm"),
    emailConfirmationTtlMinutes: getInt("EMAIL_CONFIRMATION_TTL_MINUTES", 10),
    emailConfirmationResendCooldownSeconds: getInt("EMAIL_CONFIRMATION_RESEND_COOLDOWN_SECONDS", 60),
    emailConfirmationTokenLen: getInt("EMAIL_CONFIRMATION_TOKEN_LEN", 12),
    emailConfirmationTokenMinLen: getInt("EMAIL_CONFIRMATION_TOKEN_MIN_LEN", 10),
    emailConfirmationTokenMaxLen: getInt("EMAIL_CONFIRMATION_TOKEN_MAX_LEN", 24),
    emailConfirmStoreIpPacked: getBool("EMAIL_CONFIRM_STORE_IP_PACKED", true),
    emailConfirmationSubject: getString("EMAIL_CONFIRMATION_SUBJECT", "Confirm your email"),
    emailConfirmationSubjectSubscribe: getString(
      "EMAIL_CONFIRMATION_SUBJECT_SUBSCRIBE",
      ""
    ),
    emailConfirmationSubjectUnsubscribe: getString(
      "EMAIL_CONFIRMATION_SUBJECT_UNSUBSCRIBE",
      ""
    ),

    smtpHost: getString("SMTP_HOST", ""),
    smtpPort: getInt("SMTP_PORT", 587),
    smtpSecure: getBool("SMTP_SECURE", false),
    smtpAuthEnabled: getBool("SMTP_AUTH_ENABLED", true),
    smtpUser: getString("SMTP_USER", ""),
    smtpPass: getString("SMTP_PASS", ""),
    smtpFrom: getString("SMTP_FROM", ""),
    smtpHeloName: getString("SMTP_HELO_NAME", ""),
    smtpTlsRejectUnauthorized: getBool("SMTP_TLS_REJECT_UNAUTHORIZED", true),

    mariadbHost: getString("MARIADB_HOST", "127.0.0.1"),
    mariadbPort: getInt("MARIADB_PORT", 3306),
    mariadbUser: getString("MARIADB_USER", ""),
    mariadbPassword: getString("MARIADB_PASSWORD", ""),
    mariadbDatabase: getString("MARIADB_DATABASE", ""),

    redisUrl: getString("REDIS_URL", ""),
    redisRateLimitPrefix: getString("REDIS_RATE_LIMIT_PREFIX", "rl:"),
    redisConnectTimeoutMs: getInt("REDIS_CONNECT_TIMEOUT_MS", 5000),
    // Milliseconds between optional PING keepalive pings. Set 0 to disable.
    redisPingIntervalMs: getInt("REDIS_PING_INTERVAL_MS", 15000),

    checkDnsBaseUrl: getString("CHECKDNS_BASE_URL", ""),
    checkDnsToken: getString("CHECKDNS_TOKEN", ""),
    checkDnsHttpTimeoutMs: getInt("CHECKDNS_HTTP_TIMEOUT_MS", 8000),

    rlGlobalPerMin: getInt("RL_GLOBAL_PER_MIN", 300),

    sdSubscribeDelayAfter: getInt("SD_SUBSCRIBE_DELAY_AFTER", 10),
    sdSubscribeDelayStepMs: getInt("SD_SUBSCRIBE_DELAY_STEP_MS", 250),
    rlSubscribePer10MinPerIp: getInt("RL_SUBSCRIBE_PER_10MIN_PER_IP", 60),
    rlSubscribePerHourPerTo: getInt("RL_SUBSCRIBE_PER_HOUR_PER_TO", 6),
    rlSubscribePerHourPerAlias: getInt("RL_SUBSCRIBE_PER_HOUR_PER_ALIAS", 20),

    rlConfirmPer10MinPerIp: getInt("RL_CONFIRM_PER_10MIN_PER_IP", 120),
    rlConfirmPer10MinPerToken: getInt("RL_CONFIRM_PER_10MIN_PER_TOKEN", 10),

    sdUnsubscribeDelayAfter: getInt("SD_UNSUBSCRIBE_DELAY_AFTER", 8),
    sdUnsubscribeDelayStepMs: getInt("SD_UNSUBSCRIBE_DELAY_STEP_MS", 300),
    rlUnsubscribePer10MinPerIp: getInt("RL_UNSUBSCRIBE_PER_10MIN_PER_IP", 40),
    rlUnsubscribePerHourPerAddress: getInt("RL_UNSUBSCRIBE_PER_HOUR_PER_ADDRESS", 6),

    rlUnsubscribeConfirmPer10MinPerIp: getInt("RL_UNSUBSCRIBE_CONFIRM_PER_10MIN_PER_IP", 120),
    rlUnsubscribeConfirmPer10MinPerToken: getInt("RL_UNSUBSCRIBE_CONFIRM_PER_10MIN_PER_TOKEN", 10),

    // checkdns
    rlCheckdnsPer10MinPerTarget: getInt("RL_CHECKDNS_PER_10MIN_PER_TARGET", 30),

    // request/ui
    rlRequestUiPerMinPerIp: getInt("RL_REQUEST_UI_PER_MIN_PER_IP", 60),
    rlRequestUiPer10MinPerTarget: getInt("RL_REQUEST_UI_PER_10MIN_PER_TARGET", 20),

    // request/email
    rlRequestEmailPer10MinPerIp: getInt("RL_REQUEST_EMAIL_PER_10MIN_PER_IP", 20),
    rlRequestEmailPerHourPerTarget: getInt("RL_REQUEST_EMAIL_PER_HOUR_PER_TARGET", 3),

    // credentials
    rlCredentialsCreatePerHourPerIp: getInt("RL_CREDENTIALS_CREATE_PER_HOUR_PER_IP", 10),
    rlCredentialsCreatePerHourPerEmail: getInt("RL_CREDENTIALS_CREATE_PER_HOUR_PER_EMAIL", 3),
    rlCredentialsConfirmPer10MinPerIp: getInt("RL_CREDENTIALS_CONFIRM_PER_10MIN_PER_IP", 60),
    rlCredentialsConfirmPer10MinPerToken: getInt("RL_CREDENTIALS_CONFIRM_PER_10MIN_PER_TOKEN", 5),

    // auth register
    rlAuthRegisterPerHourPerIp: getInt("RL_AUTH_REGISTER_PER_HOUR_PER_IP", 10),
    rlAuthRegisterPerHourPerEmail: getInt("RL_AUTH_REGISTER_PER_HOUR_PER_EMAIL", 3),
    rlAuthRegisterConfirmPer10MinPerIp: getInt("RL_AUTH_REGISTER_CONFIRM_PER_10MIN_PER_IP", 30),
    rlAuthRegisterConfirmPer10MinPerToken: getInt(
      "RL_AUTH_REGISTER_CONFIRM_PER_10MIN_PER_TOKEN",
      10
    ),

    // auth password reset
    rlAuthPasswordResetRequestPerHourPerIp: getInt("RL_AUTH_PASSWORD_RESET_REQUEST_PER_HOUR_PER_IP", 10),
    rlAuthPasswordResetRequestPerHourPerEmail: getInt("RL_AUTH_PASSWORD_RESET_REQUEST_PER_HOUR_PER_EMAIL", 3),
    rlAuthPasswordResetConfirmPer10MinPerIp: getInt("RL_AUTH_PASSWORD_RESET_CONFIRM_PER_10MIN_PER_IP", 30),
    rlAuthPasswordResetConfirmPer10MinPerToken: getInt("RL_AUTH_PASSWORD_RESET_CONFIRM_PER_10MIN_PER_TOKEN", 10),

    // admin login (failed attempts only)
    rlAdminLoginFailPer15MinPerIp: getInt("RL_ADMIN_LOGIN_FAIL_PER_15MIN_PER_IP", 12),
    rlAdminLoginFailPerHourPerEmail: getInt("RL_ADMIN_LOGIN_FAIL_PER_HOUR_PER_EMAIL", 6),
    rlAdminLoginFailPer6HoursPerEmailIp: getInt("RL_ADMIN_LOGIN_FAIL_PER_6H_PER_EMAIL_IP", 3),
    rlAdminLoginFailPer5MinPerEmailIp: getInt("RL_ADMIN_LOGIN_FAIL_PER_5MIN_PER_EMAIL_IP", 2),

    // alias (authenticated)
    rlAliasListPerMinPerKey: getInt("RL_ALIAS_LIST_PER_MIN_PER_KEY", 600),
    rlAliasCreatePerMinPerKey: getInt("RL_ALIAS_CREATE_PER_MIN_PER_KEY", 120),
    rlAliasDeletePerMinPerKey: getInt("RL_ALIAS_DELETE_PER_MIN_PER_KEY", 120),

    defaultAliasDomain: getString("DEFAULT_ALIAS_DOMAIN", ""),

    apiCredentialsConfirmEndpoint: getString(
      "API_CREDENTIALS_CONFIRM_ENDPOINT",
      "/api/credentials/confirm"
    ),
    apiCredentialsEmailTtlMinutes: getInt("API_CREDENTIALS_EMAIL_TTL_MINUTES", 15),
    apiCredentialsEmailResendCooldownSeconds: getInt(
      "API_CREDENTIALS_EMAIL_RESEND_COOLDOWN_SECONDS",
      60
    ),
    apiCredentialsEmailTokenLen: getInt("API_CREDENTIALS_EMAIL_TOKEN_LEN", 20),
    apiCredentialsEmailMaxSends: getInt("API_CREDENTIALS_EMAIL_MAX_SENDS", 3),
    apiCredentialsEmailSubject: getString(
      "API_CREDENTIALS_EMAIL_SUBJECT",
      "Your API token request"
    ),

    authRegisterConfirmEndpoint: getString(
      "AUTH_REGISTER_CONFIRM_ENDPOINT",
      "/auth/register/confirm"
    ),
    authRegisterTtlMinutes: getInt("AUTH_REGISTER_TTL_MINUTES", 15),
    authRegisterResendCooldownSeconds: getInt("AUTH_REGISTER_RESEND_COOLDOWN_SECONDS", 60),
    authRegisterMaxSends: getInt("AUTH_REGISTER_MAX_SENDS", 3),
    authRegisterEmailSubject: getString("AUTH_REGISTER_EMAIL_SUBJECT", "Verify your email"),
    authVerifyEmailEndpoint: getString("AUTH_VERIFY_EMAIL_ENDPOINT", "/auth/verify-email"),

    passwordResetTtlMinutes: getInt("PASSWORD_RESET_TTL_MINUTES", 15),
    passwordResetResendCooldownSeconds: getInt("PASSWORD_RESET_RESEND_COOLDOWN_SECONDS", 60),
    passwordResetMaxSends: getInt("PASSWORD_RESET_MAX_SENDS", 3),
    passwordResetEmailSubject: getString("PASSWORD_RESET_EMAIL_SUBJECT", "Password reset"),

    authRefreshTtlDays: getInt("AUTH_REFRESH_TTL_DAYS", 30),
    authMaxActiveSessionFamilies: getInt("AUTH_MAX_ACTIVE_SESSION_FAMILIES", 5),
    authCsrfSecret: getString("AUTH_CSRF_SECRET", ""),
    jwtAccessPrivateKey: getString("JWT_ACCESS_PRIVATE_KEY", ""),
    jwtAccessKid: getString("JWT_ACCESS_KID", ""),
    jwtAccessVerificationKeys: getJsonObject("JWT_ACCESS_VERIFY_KEYS", {}),
    jwtAccessIssuer: getString("JWT_ACCESS_ISSUER", "mail-forwarding-api"),
    jwtAccessAudience: getString("JWT_ACCESS_AUDIENCE", "mail-forwarding-web"),
    jwtAccessTtlSeconds: getInt("JWT_ACCESS_TTL_SECONDS", 600),
    jwtAccessClockSkewSeconds: getInt("JWT_ACCESS_CLOCK_SKEW_SECONDS", 60),

    adminAuthSessionTtlMinutes: getInt("ADMIN_AUTH_SESSION_TTL_MINUTES", 12 * 60),
    adminAuthTokenBytes: getInt("ADMIN_AUTH_TOKEN_BYTES", 32),
    adminAuthDummyPasswordHash: getString("ADMIN_AUTH_DUMMY_PASSWORD_HASH", ""),
    adminAuthArgon2TimeCost: getInt("ADMIN_AUTH_ARGON2_TIME_COST", 4),
    adminAuthArgon2MemoryCost: getInt("ADMIN_AUTH_ARGON2_MEMORY_COST", 128 * 1024),
    adminAuthArgon2Parallelism: getInt("ADMIN_AUTH_ARGON2_PARALLELISM", 1),
    adminAuthArgon2HashLength: getInt("ADMIN_AUTH_ARGON2_HASH_LENGTH", 32),
    adminAuthArgon2SaltLength: getInt("ADMIN_AUTH_ARGON2_SALT_LENGTH", 16),
    adminLoginEmailEnabled: getBool("ADMIN_LOGIN_EMAIL_ENABLED", true),
    adminLoginEmailSubject: getString(
      "ADMIN_LOGIN_EMAIL_SUBJECT",
      "Security alert: admin login | {host}"
    ),
    adminUserChangeEmailEnabled: getBool("ADMIN_USER_CHANGE_EMAIL_ENABLED", true),
    adminUserChangeEmailSubject: getString(
      "ADMIN_USER_CHANGE_EMAIL_SUBJECT",
      "Security alert: admin account changed | {host}"
    ),
  };
}

/**
 * Validate critical configuration and emit warnings for missing values.
 * Required integrations throw when missing.
 * @param {AppConfig} config
 */
function validateConfig(config) {
  const warnings = [];

  if (!config.smtpHost) warnings.push("SMTP_HOST is empty (email confirmation will fail).");
  if (!config.smtpFrom) warnings.push("SMTP_FROM is empty (email confirmation will fail).");
  if (!config.mariadbHost || !config.mariadbUser || !config.mariadbDatabase) {
    warnings.push("MariaDB connection is not fully configured.");
  }
  if (!config.appPublicUrl) warnings.push("APP_PUBLIC_URL is empty (confirmation links will be invalid).");
  if (
    Array.isArray(config.corsAllowedOrigins) &&
    config.corsAllowedOrigins.includes("*")
  ) {
    warnings.push("CORS_ALLOWED_ORIGINS must list explicit origins; '*' is not valid for cookie auth.");
  }
  if (!config.authCsrfSecret) throw new Error("missing_AUTH_CSRF_SECRET");
  if (!config.jwtAccessPrivateKey) throw new Error("missing_JWT_ACCESS_PRIVATE_KEY");
  if (!config.jwtAccessKid) throw new Error("missing_JWT_ACCESS_KID");
  if (
    !config.jwtAccessVerificationKeys ||
    typeof config.jwtAccessVerificationKeys !== "object" ||
    Object.keys(config.jwtAccessVerificationKeys).length === 0
  ) {
    throw new Error("missing_JWT_ACCESS_VERIFY_KEYS");
  }

  const activeKid = String(config.jwtAccessKid || "").trim();
  const activeVerificationKeyPem = toPem(config.jwtAccessVerificationKeys?.[activeKid]);
  if (!activeVerificationKeyPem) {
    throw new Error("missing_JWT_ACCESS_VERIFY_KEY_FOR_ACTIVE_KID");
  }

  try {
    crypto.createPrivateKey(toPem(config.jwtAccessPrivateKey));
  } catch (_) {
    throw new Error("invalid_JWT_ACCESS_PRIVATE_KEY");
  }

  try {
    crypto.createPublicKey(activeVerificationKeyPem);
  } catch (_) {
    throw new Error("invalid_JWT_ACCESS_VERIFY_KEY_FOR_ACTIVE_KID");
  }
  if (!config.checkDnsBaseUrl) throw new Error("missing_CHECKDNS_BASE_URL");
  if (!config.checkDnsToken) throw new Error("missing_CHECKDNS_TOKEN");

  if (warnings.length > 0) {
    warnings.forEach((message) => {
      console.warn(`[config] ${message}`);
    });
  }
}

const meta = loadDotenv();
const config = buildConfig(meta);
validateConfig(config);

module.exports = { config };
