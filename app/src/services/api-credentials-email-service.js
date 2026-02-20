"use strict";

/**
 * @fileoverview API credentials email workflow.
 */

const nodemailer = require("nodemailer");

const { config } = require("../config");
const { apiTokenRequestsRepository } = require("../repositories/api-token-requests-repository");
const { packIp16 } = require("../lib/ip-pack");

const crypto = require("crypto");

/**
 * @param {string} value
 * @returns {Buffer}
 */
function sha256Buffer(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest();
}

/**
 * @param {string} token
 * @returns {string}
 */
function buildConfirmUrl(token) {
  const base = String(config.appPublicUrl || "").trim().replace(/\/+$/, "");
  const endpoint = String(config.apiCredentialsConfirmEndpoint || "/api/credentials/confirm")
    .trim()
    .replace(/^\/?/, "/");

  if (!base) throw new Error("missing_APP_PUBLIC_URL");
  return `${base}${endpoint}?token=${encodeURIComponent(token)}`;
}

function makeTransport() {
  const host = config.smtpHost;
  const port = Number(config.smtpPort ?? 587);
  const secure = Boolean(config.smtpSecure);
  if (!host) throw new Error("missing_SMTP_HOST");

  const requireAuth = Boolean(config.smtpAuthEnabled);

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: requireAuth ? { user: String(config.smtpUser || ""), pass: String(config.smtpPass || "") } : undefined,
    name: config.smtpHeloName || undefined,
    tls: {
      rejectUnauthorized: Boolean(config.smtpTlsRejectUnauthorized),
    },
  });
}

/**
 * Send the API token confirmation email.
 * @param {object} payload
 * @param {string} payload.email
 * @param {number} payload.days
 * @param {string} payload.requestIpText
 * @param {string} payload.userAgent
 * @returns {Promise<{ ok: boolean, sent: boolean, reason?: string, ttl_minutes: number, pending?: object }>}
 */
async function sendApiTokenRequestEmail({ email, days, requestIpText, userAgent }) {
  const to = String(email || "").trim().toLowerCase();
  if (!to) throw new Error("invalid_email");

  const ttlMin = Number(config.apiCredentialsEmailTtlMinutes ?? 15);
  const ttlMinutes = Number.isFinite(ttlMin) && ttlMin > 0 ? ttlMin : 15;

  const cooldownSec = Number(config.apiCredentialsEmailResendCooldownSeconds ?? 60);
  const cooldownSeconds = Number.isFinite(cooldownSec) && cooldownSec >= 0 ? cooldownSec : 60;

  const maxSendRaw = Number(config.apiCredentialsEmailMaxSends ?? 3);
  const maxSendCount = Number.isFinite(maxSendRaw) && maxSendRaw > 0 ? maxSendRaw : 3;

  const requestIpPacked = requestIpText ? packIp16(requestIpText) : null;
  const ua = String(userAgent || "").slice(0, 255);

  const result = await apiTokenRequestsRepository.upsertPendingByEmailTx({
    email: to,
    days,
    ttlMinutes,
    cooldownSeconds,
    maxSendCount,
    requestIpPacked,
    userAgentOrNull: ua || null,
  });

  if (result.action === "cooldown" || result.action === "rate_limited") {
    return {
      ok: true,
      sent: false,
      reason: result.action,
      ttl_minutes: ttlMinutes,
      pending: result.pending || null,
    };
  }

  const confirmToken = result.token_plain;
  if (!confirmToken) throw new Error("missing_token_plain");

  const from = String(config.smtpFrom || "").trim();
  if (!from) throw new Error("missing_SMTP_FROM");

  const confirmUrl = buildConfirmUrl(confirmToken);
  const subject = String(config.apiCredentialsEmailSubject || "Your API token request").trim();

  const text =
    `A request was made to create an API token for ${to}.\n\n` +
    `Link (valid for ${ttlMinutes} minutes, one-time):\n` +
    `${confirmUrl}\n\n` +
    `If you did not request this, ignore this message.\n`;

  const html =
    `<p>A request was made to create an API token for <strong>${to}</strong>.</p>` +
    `<p><strong>Validity:</strong> ${ttlMinutes} minutes (one-time link)</p>` +
    `<p><a href="${confirmUrl}">${confirmUrl}</a></p>` +
    `<p>If you did not request this, ignore this message.</p>`;

  const transporter = makeTransport();
  await transporter.sendMail({ from, to, subject, text, html });

  return {
    ok: true,
    sent: true,
    to,
    ttl_minutes: ttlMinutes,
    pending: result.pending || null,
    action: result.action || "created",
  };
}

module.exports = { sendApiTokenRequestEmail, sha256Buffer };
