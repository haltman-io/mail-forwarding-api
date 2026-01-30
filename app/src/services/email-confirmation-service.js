"use strict";

/**
 * @fileoverview Email confirmation workflow (token + DB + SMTP).
 */

const crypto = require("crypto");
const nodemailer = require("nodemailer");

const { config } = require("../config");
const { emailConfirmationsRepository } = require("../repositories/email-confirmations-repository");

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Generate a Base62 token with unbiased entropy.
 * @param {number} len
 * @returns {string}
 */
function generateBase62Token(len = 12) {
  if (!Number.isFinite(len) || len < 8 || len > 64) {
    throw new Error("invalid_token_length");
  }

  const out = [];
  while (out.length < len) {
    const buf = crypto.randomBytes(32);
    for (let i = 0; i < buf.length && out.length < len; i++) {
      const x = buf[i];
      if (x < 248) out.push(BASE62[x % 62]);
    }
  }
  return out.join("");
}

/**
 * @param {string} value
 * @returns {Buffer}
 */
function sha256Buffer(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest();
}

function normalizeEmailStrict(email) {
  if (typeof email !== "string") return "";
  return email.trim().toLowerCase();
}

function assertIntent(intent) {
  if (typeof intent !== "string") throw new Error("invalid_intent");
  const value = intent.trim().toLowerCase();
  if (!value || value.length > 32) throw new Error("invalid_intent");
  return value;
}

/**
 * @param {string} token
 * @returns {string}
 */
function buildConfirmUrl(token) {
  const base = String(config.appPublicUrl || "").trim().replace(/\/+$/, "");
  const endpoint = String(config.emailConfirmEndpoint || "/forward/confirm")
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
    auth: requireAuth
      ? { user: String(config.smtpUser || ""), pass: String(config.smtpPass || "") }
      : undefined,
    name: config.smtpHeloName || undefined,
    tls: {
      rejectUnauthorized: Boolean(config.smtpTlsRejectUnauthorized),
    },
  });
}

/**
 * Send confirmation email and persist pending token.
 * @param {object} payload
 * @param {string} payload.email
 * @param {string} payload.requestIpText
 * @param {string} payload.userAgent
 * @param {string} payload.aliasName
 * @param {string} payload.aliasDomain
 * @param {string} [payload.intent]
 * @returns {Promise<{ ok: boolean, sent: boolean, reason?: string, ttl_minutes: number }>}
 */
async function sendEmailConfirmation({ email, requestIpText, userAgent, aliasName, aliasDomain, intent }) {
  const to = normalizeEmailStrict(email);
  if (!to) throw new Error("invalid_email");

  const ttlMin = Number(config.emailConfirmationTtlMinutes ?? 10);
  const ttlMinutes = Number.isFinite(ttlMin) && ttlMin > 0 ? ttlMin : 10;
  const ttlMinutesInt = ttlMinutes;

  const cooldownSec = Number(config.emailConfirmationResendCooldownSeconds ?? 60);
  const cooldownSeconds = Number.isFinite(cooldownSec) && cooldownSec >= 0 ? cooldownSec : 60;

  const tokenLen = Number(config.emailConfirmationTokenLen ?? 12);
  const tokenLength = Number.isFinite(tokenLen) ? tokenLen : 12;

  const pending = await emailConfirmationsRepository.getActivePendingByEmail(to);

  if (pending) {
    const lastSentAt = pending.last_sent_at ? new Date(pending.last_sent_at) : null;
    if (lastSentAt) {
      const elapsed = (Date.now() - lastSentAt.getTime()) / 1000;
      if (elapsed < cooldownSeconds) {
        return { ok: true, sent: false, reason: "cooldown", ttl_minutes: ttlMinutes };
      }
    }
  }

  const token = generateBase62Token(tokenLength);
  const tokenHash32 = sha256Buffer(token);

  const requestIpStringOrNull =
    requestIpText && typeof requestIpText === "string" ? requestIpText : null;

  const intentNormalized = intent ? assertIntent(intent) : "subscribe";

  if (pending) {
    await emailConfirmationsRepository.rotateTokenForPending({
      email: to,
      tokenHash32,
      ttlMinutes: ttlMinutesInt,
      requestIpStringOrNull,
      userAgentOrNull: userAgent || "",
    });
  } else {
    await emailConfirmationsRepository.createPending({
      email: to,
      tokenHash32,
      ttlMinutes: ttlMinutesInt,
      requestIpStringOrNull,
      userAgentOrNull: userAgent || "",
      intent: intentNormalized,
      aliasName,
      aliasDomain,
    });
  }

  const confirmUrl = buildConfirmUrl(token);

  const from = String(config.smtpFrom || "").trim();
  if (!from) throw new Error("missing_SMTP_FROM");

  const subject =
    intentNormalized === "unsubscribe"
      ? config.emailConfirmationSubjectUnsubscribe || config.emailConfirmationSubject
      : config.emailConfirmationSubjectSubscribe || config.emailConfirmationSubject || "Confirm your email";

  const actionLabel =
    intentNormalized === "unsubscribe" ? "remove this alias" : "create this alias";

  const text =
    `Confirm your email address to ${actionLabel}.\n\n` +
    `Address: ${aliasName}@${aliasDomain}\n` +
    `Link (valid for ${ttlMinutes} minutes):\n` +
    `${confirmUrl}\n\n` +
    `If you did not request this, you can ignore this message.\n`;

  const html =
    `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Action confirmation — Haltman.io</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>

<body style="margin:0; padding:0; background-color:#09090b;">
  <!-- Full-width wrapper -->
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#09090b;">
    <tr>
      <td align="center" style="padding:36px 14px;">

        <!-- Outer container (max width) -->
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
               style="max-width:640px; border-collapse:separate; border-spacing:0;">
          <tr>
            <td style="
              background-color:#09090b;
              background-image:
                radial-gradient(600px 220px at 50% 0%, rgba(255,255,255,0.07), rgba(255,255,255,0) 60%),
                radial-gradient(520px 240px at 50% 110%, rgba(255,255,255,0.05), rgba(255,255,255,0) 60%);
              padding:0;
            ">

              <!-- Card -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                     style="
                      background-color:rgba(9,9,11,0.82);
                      border:1px solid rgba(255,255,255,0.10);
                      border-radius:16px;
                      overflow:hidden;
                      box-shadow:0 18px 60px rgba(0,0,0,0.55);
                    ">
                <!-- Header -->
                <tr>
                  <td style="padding:18px 20px 14px; border-bottom:1px solid rgba(255,255,255,0.08);">
                    <!-- Top row: brand + subtle pill -->
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                      <tr>
                        <td align="left" style="vertical-align:middle;">
                          <p style="
                            margin:0;
                            font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                            font-size:14px;
                            font-weight:600;
                            color:rgba(255,255,255,0.92);
                            letter-spacing:0.2px;
                          ">
                            Haltman.io
                          </p>
                          <p style="
                            margin:4px 0 0;
                            font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                            font-size:12px;
                            color:rgba(255,255,255,0.55);
                            line-height:1.35;
                          ">
                            Free Mail Forwarding Service
                          </p>
                        </td>

                        <td align="right" style="vertical-align:middle;">
                          <!-- “Pill” badge -->
                          <span style="
                            display:inline-block;
                            padding:6px 10px;
                            border:1px solid rgba(255,255,255,0.10);
                            border-radius:999px;
                            background-color:rgba(255,255,255,0.04);
                            font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;
                            font-size:11px;
                            color:rgba(255,255,255,0.70);
                            white-space:nowrap;
                          ">
                            forward.haltman.io
                          </span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- Body -->
                <tr>
                  <td style="padding:20px;">
                    <h1 style="
                      margin:0 0 10px;
                      font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                      font-size:18px;
                      font-weight:650;
                      color:rgba(255,255,255,0.92);
                      letter-spacing:0.1px;
                    ">
                      Confirm this action
                    </h1>

                    <p style="
                      margin:0 0 16px;
                      font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                      font-size:13px;
                      line-height:1.6;
                      color:rgba(255,255,255,0.62);
                    ">
                      A request was made to modify your mail aliases. Please confirm to proceed.
                    </p>

                    <!-- “Console-like” panel -->
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                           style="
                            background-color:rgba(0,0,0,0.28);
                            border:1px solid rgba(255,255,255,0.10);
                            border-radius:14px;
                            overflow:hidden;
                          ">
                      <tr>
                        <td style="padding:14px 14px 12px;">
                          <!-- Action row -->
                          <p style="
                            margin:0 0 6px;
                            font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                            font-size:11px;
                            color:rgba(255,255,255,0.45);
                            letter-spacing:0.2px;
                            text-transform:uppercase;
                          ">
                            Action
                          </p>
                          <p style="
                            margin:0 0 12px;
                            font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;
                            font-size:13px;
                            color:rgba(255,255,255,0.86);
                          ">
                            ${intentNormalized === "unsubscribe" ? "Remove alias" : "Create alias"}
                          </p>

                          <!-- Alias row -->
                          <p style="
                            margin:0 0 6px;
                            font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                            font-size:11px;
                            color:rgba(255,255,255,0.45);
                            letter-spacing:0.2px;
                            text-transform:uppercase;
                          ">
                            Alias email
                          </p>
                          <p style="
                            margin:0 0 12px;
                            font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;
                            font-size:13px;
                            color:rgba(255,255,255,0.86);
                            word-break:break-word;
                          ">
                            ${aliasName}@${aliasDomain}
                          </p>
                          <!-- Confirmation code row -->
                          <p style="
                            margin:0 0 6px;
                            font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                            font-size:11px;
                            color:rgba(255,255,255,0.45);
                            letter-spacing:0.2px;
                            text-transform:uppercase;
                          ">
                            Confirmation code
                          </p>

                          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin:0 0 12px;">
                            <tr>
                              <td style="
                                padding:10px 12px;
                                border-radius:12px;
                                border:1px solid rgba(255,255,255,0.10);
                                background-color:rgba(255,255,255,0.04);
                              ">
                                <span style="
                                  display:block;
                                  font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;
                                  font-size:14px;
                                  font-weight:700;
                                  color:rgba(255,255,255,0.92);
                                  letter-spacing:1.6px;
                                  text-transform:uppercase;
                                  word-break:break-all;
                                ">${token}</span>
                                <span style="
                                  display:block;
                                  margin-top:6px;
                                  font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                                  font-size:12px;
                                  line-height:1.4;
                                  color:rgba(255,255,255,0.55);
                                ">
                                  Paste this code in the confirmation dialog.
                                </span>
                              </td>
                            </tr>
                          </table>


                          <!-- Expiration row -->
                          <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                            <tr>
                              <td align="left" style="vertical-align:middle;">
                                <p style="
                                  margin:0;
                                  font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                                  font-size:12px;
                                  color:rgba(255,255,255,0.55);
                                ">
                                  Valid for <strong style="color:rgba(255,255,255,0.78); font-weight:600;">${ttlMinutes}</strong> minutes
                                </p>
                              </td>
                              <td align="right" style="vertical-align:middle;">
                                <!-- Subtle status badge -->
                                <span style="
                                  display:inline-block;
                                  padding:5px 10px;
                                  border-radius:999px;
                                  border:1px solid rgba(255,255,255,0.10);
                                  background-color:rgba(255,255,255,0.04);
                                  font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                                  font-size:11px;
                                  color:rgba(255,255,255,0.62);
                                  white-space:nowrap;
                                ">
                                  confirmation required
                                </span>
                              </td>
                            </tr>
                          </table>

                        </td>
                      </tr>
                    </table>

                    <!-- CTA button (email-safe) -->
                    <table cellpadding="0" cellspacing="0" role="presentation" style="margin-top:16px;">
                      <tr>
                        <td align="left">
                          <a href="${confirmUrl}" style="
                            display:inline-block;
                            padding:11px 16px;
                            border-radius:12px;
                            background-color:rgba(255,255,255,0.92);
                            border:1px solid rgba(255,255,255,0.15);
                            color:#0b0b0f;
                            text-decoration:none;
                            font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                            font-size:13px;
                            font-weight:650;
                            letter-spacing:0.1px;
                          ">
                            Confirm action
                          </a>
                        </td>

                        <!-- Optional “ghost” secondary hint (non-button, safer) -->
                        <td style="padding-left:10px; vertical-align:middle;">
                          <span style="
                            display:inline-block;
                            padding:9px 12px;
                            border-radius:12px;
                            border:1px solid rgba(255,255,255,0.10);
                            background-color:rgba(255,255,255,0.03);
                            font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                            font-size:12px;
                            color:rgba(255,255,255,0.60);
                            white-space:nowrap;
                          ">
                            secure confirmation
                          </span>
                        </td>
                      </tr>
                    </table>

                    <!-- Fallback link -->
                    <p style="
                      margin:16px 0 0;
                      font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                      font-size:12px;
                      line-height:1.6;
                      color:rgba(255,255,255,0.55);
                    ">
                      If the button doesn’t work, open this link:
                      <br />
                      <a href="${confirmUrl}" style="
                        color:rgba(255,255,255,0.80);
                        text-decoration:underline;
                        word-break:break-all;
                        font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;
                        font-size:12px;
                      ">${confirmUrl}</a>
                    </p>

                    <!-- Safety note -->
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:14px;">
                      <tr>
                        <td style="
                          padding:12px 14px;
                          border-radius:14px;
                          border:1px solid rgba(255,255,255,0.08);
                          background-color:rgba(255,255,255,0.03);
                        ">
                          <p style="
                            margin:0;
                            font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                            font-size:12px;
                            line-height:1.6;
                            color:rgba(255,255,255,0.58);
                          ">
                            If you did not request this, ignore this email. No changes will be applied without confirmation.
                          </p>
                        </td>
                      </tr>
                    </table>

                  </td>
                </tr>

                <!-- Minimal footer (not the app footer) -->
                <tr>
                  <td style="padding:14px 20px 18px; border-top:1px solid rgba(255,255,255,0.08);">
                    <p style="
                      margin:0;
                      font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
                      font-size:11px;
                      line-height:1.6;
                      color:rgba(255,255,255,0.42);
                    ">
                      Automated message from Haltman.io. Please do not reply.
                    </p>
                  </td>
                </tr>

              </table>
              <!-- /Card -->

            </td>
          </tr>
        </table>
        <!-- /Outer container -->

      </td>
    </tr>
  </table>
</body>
</html>

    `;

  const transporter = makeTransport();
  await transporter.sendMail({ from, to, subject, text, html });

  return { ok: true, sent: true, to, ttl_minutes: ttlMinutes };
}

module.exports = { sendEmailConfirmation, generateBase62Token, sha256Buffer };
