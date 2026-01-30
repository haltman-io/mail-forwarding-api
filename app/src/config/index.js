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
 * @property {string} defaultAliasDomain
 * @property {string} apiCredentialsConfirmEndpoint
 * @property {number} apiCredentialsEmailTtlMinutes
 * @property {number} apiCredentialsEmailResendCooldownSeconds
 * @property {number} apiCredentialsEmailTokenLen
 * @property {string} apiCredentialsEmailSubject
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
    apiCredentialsEmailSubject: getString(
      "API_CREDENTIALS_EMAIL_SUBJECT",
      "Your API token request"
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

  if (!config.smtpHost) warnings.push("SMTP_HOST is empty (email confirmation will fail)." );
  if (!config.smtpFrom) warnings.push("SMTP_FROM is empty (email confirmation will fail)." );
  if (!config.mariadbHost || !config.mariadbUser || !config.mariadbDatabase) {
    warnings.push("MariaDB connection is not fully configured.");
  }
  if (!config.appPublicUrl) warnings.push("APP_PUBLIC_URL is empty (confirmation links will be invalid).");
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
