"use strict";

/**
 * @fileoverview Password reset email workflow.
 */

const nodemailer = require("nodemailer");

const { config } = require("../config");
const {
  passwordResetRequestsRepository,
} = require("../repositories/password-reset-requests-repository");
const { packIp16 } = require("../lib/ip-pack");
const { buildEmailSubject } = require("../lib/email-subject-template");

function normalizeEmailStrict(email) {
  if (typeof email !== "string") return "";
  return email.trim().toLowerCase();
}

function getPasswordResetTtlMinutes() {
  const raw = Number(config.passwordResetTtlMinutes ?? 15);
  if (!Number.isFinite(raw) || raw <= 0 || raw > 60) return 15;
  return Math.floor(raw);
}

function getPasswordResetCooldownSeconds() {
  const raw = Number(config.passwordResetResendCooldownSeconds ?? 60);
  if (!Number.isFinite(raw) || raw < 0) return 60;
  return Math.floor(raw);
}

function getPasswordResetMaxSends() {
  const raw = Number(config.passwordResetMaxSends ?? 3);
  if (!Number.isFinite(raw) || raw <= 0 || raw > 20) return 3;
  return Math.floor(raw);
}

function getDefaultHost() {
  const base = String(config.appPublicUrl || "").trim();
  if (!base) return "localhost";
  try {
    return new URL(base).hostname || "localhost";
  } catch (_) {
    return base.replace(/^https?:\/\//i, "").replace(/\/.*$/, "") || "localhost";
  }
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
 * Send password reset email and persist the one-time token.
 * @param {object} payload
 * @param {number} payload.userId
 * @param {string} payload.email
 * @param {string} payload.requestIpText
 * @param {string} payload.userAgent
 * @returns {Promise<{ ok: boolean, sent: boolean, reason?: string, ttl_minutes: number, pending?: object }>}
 */
async function sendPasswordResetEmail({ userId, email, requestIpText, userAgent }) {
  const normalizedUserId = Number(userId);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    throw new Error("invalid_user_id");
  }

  const to = normalizeEmailStrict(email);
  if (!to) throw new Error("invalid_email");

  const ttlMinutes = getPasswordResetTtlMinutes();
  const cooldownSeconds = getPasswordResetCooldownSeconds();
  const maxSendCount = getPasswordResetMaxSends();
  const requestIpPacked = requestIpText ? packIp16(requestIpText) : null;
  const ua = String(userAgent || "").slice(0, 255);

  const result = await passwordResetRequestsRepository.upsertPendingByUserIdTx({
    userId: normalizedUserId,
    email: to,
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

  const token = result.token_plain;
  if (!token) throw new Error("missing_token_plain");

  const from = String(config.smtpFrom || "").trim();
  if (!from) throw new Error("missing_SMTP_FROM");

  const host = getDefaultHost();
  const subject = buildEmailSubject({
    template: config.passwordResetEmailSubject || "Password reset",
    host,
    code: token,
  });

  const resetEndpoint = "POST /auth/password/reset";
  const text =
    `YOUR VERIFICATION CODE IS: ${token}\n` +
    `EXPIRES IN ${ttlMinutes} MINUTES.\n\n` +
    `PASSWORD RESET REQUEST DETECTED.\n` +
    `STATUS: PENDING CONFIRMATION.\n\n` +
    `USE THIS CODE ONLY ON\n` +
    `${resetEndpoint}\n\n` +
    `SET A NEW PASSWORD USING THE TOKEN.\n` +
    `THIS TOKEN IS SINGLE-USE AND WILL BE DISCARDED AFTER SUCCESS.\n\n` +
    `IGNORE IF THIS WASN'T YOU.\n` +
    `NO TOKEN, NO PASSWORD CHANGE.\n\n` +
    `---\n` +
    `SYSTEM GENERATED MESSAGE. REPLIES ARE /dev/null.\n` +
    `POWERED BY HALTMAN.IO & THE HACKER'S CHOICE\n`;

  const html =
    `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${host}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <meta name="supported-color-schemes" content="dark" />
  </head>

  <body style="margin:0;padding:0;background-color:#09090b;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">
      Your password reset code is ${token}. Expires in ${ttlMinutes} minutes.
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#09090b;">
      <tr>
        <td align="center" style="padding:36px 14px;">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;border-collapse:separate;border-spacing:0;">
            <tr>
              <td style="background-color:#09090b;background-image:radial-gradient(600px 220px at 50% 0,rgba(255,255,255,.07),rgba(255,255,255,0) 60%),radial-gradient(520px 240px at 50% 110%,rgba(255,255,255,.05),rgba(255,255,255,0) 60%);padding:0;">
                <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:rgba(9,9,11,.82);border:1px solid rgba(255,255,255,.1);border-radius:16px;overflow:hidden;box-shadow:0 18px 60px rgba(0,0,0,.55);">
                  <tr>
                    <td style="padding:18px 20px 14px;border-bottom:1px solid rgba(255,255,255,.08);">
                      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                        <tr>
                          <td align="left" style="vertical-align:middle;">
                            <p style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:rgba(255,255,255,.92);letter-spacing:.2px;">
                              ${host}
                            </p>
                            <p style="margin:4px 0 0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:rgba(255,255,255,.55);line-height:1.35;">
                              Password recovery
                            </p>
                          </td>
                          <td align="right" style="vertical-align:middle;">
                            <span style="display:inline-block;padding:6px 10px;border:1px solid rgba(255,255,255,.1);border-radius:999px;background-color:rgba(255,255,255,.04);font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:11px;color:rgba(255,255,255,.7);white-space:nowrap;">
                              PASSWORD RESET
                            </span>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:20px;">
                      <p style="margin:0 0 10px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:rgba(255,255,255,.86);">
                        Your password reset code is:
                      </p>

                      <p style="margin:0 0 14px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:22px;font-weight:800;color:rgba(255,255,255,.92);letter-spacing:2.2px;" aria-label="Verification code">
                        ${token}
                      </p>

                      <p style="margin:0 0 14px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:rgba(255,255,255,.62);">
                        Use this code within
                        <strong style="color:rgba(255,255,255,.78);font-weight:600;">${ttlMinutes} minutes</strong>
                        on
                        <strong style="color:rgba(255,255,255,.78);font-weight:600;">${resetEndpoint}</strong>.
                      </p>

                      <p style="margin:0 0 16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:rgba(255,255,255,.62);">
                        This token is single-use and will be discarded after a successful password change. Ignore this email if you did not request it.
                      </p>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:14px 20px 18px;border-top:1px solid rgba(255,255,255,.08);">
                      <p style="margin:0;text-align:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:11px;line-height:1.6;color:rgba(255,255,255,.42);">
                        POWERED BY <strong style="color:rgba(255,255,255,.78);font-weight:600;">HALTMAN.IO</strong> &amp;
                        <strong style="color:rgba(255,255,255,.78);font-weight:600;">THE HACKER'S CHOICE</strong>
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
    `;

  const transporter = makeTransport();
  await transporter.sendMail({ from, to, subject, text, html });

  return {
    ok: true,
    sent: true,
    ttl_minutes: ttlMinutes,
    pending: result.pending || null,
    action: result.action || "created",
  };
}

module.exports = {
  sendPasswordResetEmail,
};
