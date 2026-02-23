"use strict";

/**
 * @fileoverview Admin user management change notification email service.
 */

const nodemailer = require("nodemailer");
const format = require("string-format");
const { config } = require("../config");

function normalizeEmailStrict(email) {
  if (typeof email !== "string") return "";
  return email.trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getTenantHost() {
  const base = String(config.appPublicUrl || "").trim();
  if (!base) return "mail-forwarding-api";

  try {
    return new URL(base).hostname || "mail-forwarding-api";
  } catch (_) {
    return base.replace(/^https?:\/\//i, "").replace(/\/.*$/, "") || "mail-forwarding-api";
  }
}

function buildSubject({ host, action, targetEmail, actorEmail, occurredAtIso }) {
  const fallback = "Security alert: admin account changed | {host}";
  const template = String(config.adminUserChangeEmailSubject || fallback).trim() || fallback;

  try {
    return format(template, {
      host,
      action,
      target_email: targetEmail,
      actor_email: actorEmail,
      occurred_at: occurredAtIso,
    }).trim();
  } catch (_) {
    return format(fallback, { host }).trim();
  }
}

function buildWelcomeSubject({ host, targetEmail, actorEmail, occurredAtIso }) {
  const fallback = "Welcome: admin account created | {host}";

  try {
    return format(fallback, {
      host,
      target_email: targetEmail,
      actor_email: actorEmail,
      occurred_at: occurredAtIso,
    }).trim();
  } catch (_) {
    return format(fallback, { host }).trim();
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
 * Send admin user management notification email.
 * @param {object} payload
 * @param {string} payload.toEmail
 * @param {string} payload.targetEmail
 * @param {string} payload.actorEmail
 * @param {string} payload.action
 * @param {string[]} [payload.changes]
 * @param {string} [payload.requestIpText]
 * @param {string} [payload.userAgent]
 * @param {Date | string | number} [payload.occurredAt]
 * @returns {Promise<{ ok: boolean, sent: boolean, to: string, occurred_at: string }>}
 */
async function sendAdminUserChangeNotificationEmail({
  toEmail,
  targetEmail,
  actorEmail,
  action,
  changes,
  requestIpText,
  userAgent,
  occurredAt,
}) {
  const to = normalizeEmailStrict(toEmail);
  const target = normalizeEmailStrict(targetEmail);
  const actor = normalizeEmailStrict(actorEmail);
  const normalizedAction = String(action || "").trim().toLowerCase();

  if (!to || !target || !actor || !normalizedAction) throw new Error("invalid_payload");

  const when = occurredAt ? new Date(occurredAt) : new Date();
  const occurredAtIso = Number.isNaN(when.getTime()) ? new Date().toISOString() : when.toISOString();
  const occurredAtUtc = new Date(occurredAtIso).toUTCString();
  const requestIp = String(requestIpText || "").trim() || "unknown";
  const ua = String(userAgent || "").trim() || "unknown";
  const changeList = Array.isArray(changes)
    ? changes
        .map((item) => String(item || "").trim())
        .filter(Boolean)
        .slice(0, 20)
    : [];
  const changeSummary = changeList.length > 0 ? changeList.join(", ") : "metadata";

  const from = String(config.smtpFrom || "").trim();
  if (!from) throw new Error("missing_SMTP_FROM");

  const host = getTenantHost();
  const subject = buildSubject({
    host,
    action: normalizedAction,
    targetEmail: target,
    actorEmail: actor,
    occurredAtIso,
  });

  const text =
    `ADMIN ACCOUNT CHANGE DETECTED.\n\n` +
    `ACTION: ${normalizedAction}\n` +
    `TARGET ADMIN: ${target}\n` +
    `ACTOR ADMIN: ${actor}\n` +
    `CHANGES: ${changeSummary}\n` +
    `DATE/TIME (ISO 8601): ${occurredAtIso}\n` +
    `DATE/TIME (UTC): ${occurredAtUtc}\n` +
    `SOURCE IP: ${requestIp}\n` +
    `USER AGENT: ${ua}\n\n` +
    `IF THIS WASN'T EXPECTED, ROTATE CREDENTIALS IMMEDIATELY.\n` +
    `SYSTEM GENERATED MESSAGE. REPLIES ARE /dev/null.\n`;

  const html =
    `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(host)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <meta name="supported-color-schemes" content="dark" />
  </head>

  <body style="margin:0;padding:0;background-color:#09090b;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">
      Admin account change detected (${escapeHtml(normalizedAction)}) for ${escapeHtml(target)}.
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#09090b;">
      <tr>
        <td align="center" style="padding:36px 14px;">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;border-collapse:separate;border-spacing:0;">
            <tr>
              <td
                style="background-color:#09090b;background-image:radial-gradient(600px 220px at 50% 0,rgba(255,255,255,.07),rgba(255,255,255,0) 60%),radial-gradient(520px 240px at 50% 110%,rgba(255,255,255,.05),rgba(255,255,255,0) 60%);padding:0;"
              >
                <table
                  width="100%"
                  cellpadding="0"
                  cellspacing="0"
                  role="presentation"
                  style="background-color:rgba(9,9,11,.82);border:1px solid rgba(255,255,255,.1);border-radius:16px;overflow:hidden;box-shadow:0 18px 60px rgba(0,0,0,.55);"
                >
                  <tr>
                    <td style="padding:18px 20px 14px;border-bottom:1px solid rgba(255,255,255,.08);">
                      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                        <tr>
                          <td align="left" style="vertical-align:middle;">
                            <p style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:rgba(255,255,255,.92);letter-spacing:.2px;">
                              ${escapeHtml(host)}
                            </p>
                            <p style="margin:4px 0 0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:rgba(255,255,255,.55);line-height:1.35;">
                              Security Event Notification
                            </p>
                          </td>
                          <td align="right" style="vertical-align:middle;">
                            <span
                              style="display:inline-block;padding:6px 10px;border:1px solid rgba(255,255,255,.1);border-radius:999px;background-color:rgba(255,255,255,.04);font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:11px;color:rgba(255,255,255,.7);white-space:nowrap;"
                            >
                              ADMIN CHANGE
                            </span>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:20px;">
                      <p style="margin:0 0 14px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:rgba(255,255,255,.86);">
                        An administrative account update was performed.
                      </p>

                      <table
                        width="100%"
                        cellpadding="0"
                        cellspacing="0"
                        role="presentation"
                        style="background-color:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.1);border-radius:14px;overflow:hidden;"
                      >
                        <tr>
                          <td style="padding:14px 14px 12px;">
                            <pre
                              style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:12px;line-height:1.7;color:rgba(255,255,255,.86);white-space:pre-wrap;word-break:break-word;"
                            ><code>ACTION: ${escapeHtml(normalizedAction)}
TARGET ADMIN: ${escapeHtml(target)}
ACTOR ADMIN: ${escapeHtml(actor)}
CHANGES: ${escapeHtml(changeSummary)}
DATE/TIME (ISO 8601): ${escapeHtml(occurredAtIso)}
DATE/TIME (UTC): ${escapeHtml(occurredAtUtc)}
SOURCE IP: ${escapeHtml(requestIp)}
USER AGENT: ${escapeHtml(ua)}</code></pre>
                          </td>
                        </tr>
                      </table>

                      <p style="margin:16px 0 0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:rgba(255,255,255,.62);">
                        If this action was not expected, rotate credentials immediately and review logs.
                      </p>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:14px 20px 18px;border-top:1px solid rgba(255,255,255,.08);">
                      <p style="margin:0;text-align:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:11px;line-height:1.6;color:rgba(255,255,255,.42);">
                        SYSTEM GENERATED MESSAGE. REPLIES ARE /dev/null.
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
    to,
    occurred_at: occurredAtIso,
  };
}

/**
 * Send welcome email to a newly created admin account.
 * This message intentionally excludes IP and user-agent details.
 * @param {object} payload
 * @param {string} payload.toEmail
 * @param {string} payload.targetEmail
 * @param {string} payload.actorEmail
 * @param {Date | string | number} [payload.occurredAt]
 * @returns {Promise<{ ok: boolean, sent: boolean, to: string, occurred_at: string }>}
 */
async function sendAdminUserWelcomeEmail({
  toEmail,
  targetEmail,
  actorEmail,
  occurredAt,
}) {
  const to = normalizeEmailStrict(toEmail);
  const target = normalizeEmailStrict(targetEmail);
  const actor = normalizeEmailStrict(actorEmail);

  if (!to || !target || !actor) throw new Error("invalid_payload");

  const when = occurredAt ? new Date(occurredAt) : new Date();
  const occurredAtIso = Number.isNaN(when.getTime()) ? new Date().toISOString() : when.toISOString();
  const occurredAtUtc = new Date(occurredAtIso).toUTCString();

  const from = String(config.smtpFrom || "").trim();
  if (!from) throw new Error("missing_SMTP_FROM");

  const host = getTenantHost();
  const subject = buildWelcomeSubject({
    host,
    targetEmail: target,
    actorEmail: actor,
    occurredAtIso,
  });

  const text =
    `WELCOME TO THE ADMIN PANEL.\n\n` +
    `A new administrator account has been created for you.\n\n` +
    `NEW ADMIN: ${target}\n` +
    `CREATED BY ADMIN: ${actor}\n` +
    `DATE/TIME (ISO 8601): ${occurredAtIso}\n` +
    `DATE/TIME (UTC): ${occurredAtUtc}\n\n` +
    `Your credential will be delivered securely through another channel.\n` +
    `For security reasons, credentials are never sent by email.\n\n` +
    `SYSTEM GENERATED MESSAGE. REPLIES ARE /dev/null.\n`;

  const html =
    `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${escapeHtml(host)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <meta name="supported-color-schemes" content="dark" />
  </head>

  <body style="margin:0;padding:0;background-color:#09090b;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">
      Welcome. Your administrator account was created by ${escapeHtml(actor)}.
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#09090b;">
      <tr>
        <td align="center" style="padding:36px 14px;">
          <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:640px;border-collapse:separate;border-spacing:0;">
            <tr>
              <td
                style="background-color:#09090b;background-image:radial-gradient(600px 220px at 50% 0,rgba(255,255,255,.07),rgba(255,255,255,0) 60%),radial-gradient(520px 240px at 50% 110%,rgba(255,255,255,.05),rgba(255,255,255,0) 60%);padding:0;"
              >
                <table
                  width="100%"
                  cellpadding="0"
                  cellspacing="0"
                  role="presentation"
                  style="background-color:rgba(9,9,11,.82);border:1px solid rgba(255,255,255,.1);border-radius:16px;overflow:hidden;box-shadow:0 18px 60px rgba(0,0,0,.55);"
                >
                  <tr>
                    <td style="padding:18px 20px 14px;border-bottom:1px solid rgba(255,255,255,.08);">
                      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                        <tr>
                          <td align="left" style="vertical-align:middle;">
                            <p style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:rgba(255,255,255,.92);letter-spacing:.2px;">
                              ${escapeHtml(host)}
                            </p>
                            <p style="margin:4px 0 0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:rgba(255,255,255,.55);line-height:1.35;">
                              Welcome to Admin Access
                            </p>
                          </td>
                          <td align="right" style="vertical-align:middle;">
                            <span
                              style="display:inline-block;padding:6px 10px;border:1px solid rgba(255,255,255,.1);border-radius:999px;background-color:rgba(255,255,255,.04);font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:11px;color:rgba(255,255,255,.7);white-space:nowrap;"
                            >
                              WELCOME
                            </span>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:20px;">
                      <p style="margin:0 0 14px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:rgba(255,255,255,.86);">
                        A new administrator account has been created for you.
                      </p>

                      <table
                        width="100%"
                        cellpadding="0"
                        cellspacing="0"
                        role="presentation"
                        style="background-color:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.1);border-radius:14px;overflow:hidden;"
                      >
                        <tr>
                          <td style="padding:14px 14px 12px;">
                            <pre
                              style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:12px;line-height:1.7;color:rgba(255,255,255,.86);white-space:pre-wrap;word-break:break-word;"
                            ><code>NEW ADMIN: ${escapeHtml(target)}
CREATED BY ADMIN: ${escapeHtml(actor)}
DATE/TIME (ISO 8601): ${escapeHtml(occurredAtIso)}
DATE/TIME (UTC): ${escapeHtml(occurredAtUtc)}</code></pre>
                          </td>
                        </tr>
                      </table>

                      <p style="margin:16px 0 0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:rgba(255,255,255,.62);">
                        Your credential will be delivered securely through another channel.
                      </p>
                      <p style="margin:8px 0 0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:rgba(255,255,255,.62);">
                        For security reasons, credentials are never sent by email.
                      </p>
                    </td>
                  </tr>

                  <tr>
                    <td style="padding:14px 20px 18px;border-top:1px solid rgba(255,255,255,.08);">
                      <p style="margin:0;text-align:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:11px;line-height:1.6;color:rgba(255,255,255,.42);">
                        SYSTEM GENERATED MESSAGE. REPLIES ARE /dev/null.
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
    to,
    occurred_at: occurredAtIso,
  };
}

module.exports = { sendAdminUserChangeNotificationEmail, sendAdminUserWelcomeEmail };
