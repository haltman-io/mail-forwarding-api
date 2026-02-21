"use strict";

/**
 * @fileoverview API credentials email workflow.
 */

const crypto = require("crypto");
const nodemailer = require("nodemailer");

const { config } = require("../config");
const { apiTokenRequestsRepository } = require("../repositories/api-token-requests-repository");
const { packIp16 } = require("../lib/ip-pack");

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

function getDefaultConfirmBaseUrl() {
  const base = String(config.appPublicUrl || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("missing_APP_PUBLIC_URL");
  return base;
}

function parseRequestedDays(days) {
  const num = Number(days);
  if (!Number.isInteger(num) || num <= 0 || num > 90) return 1;
  return num;
}

/**
 * @param {string} token
 * @param {string} [baseUrl]
 * @returns {string}
 */
function buildConfirmUrl(token, baseUrl) {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "") || getDefaultConfirmBaseUrl();
  const endpoint = String(config.apiCredentialsConfirmEndpoint || "/api/credentials/confirm")
    .trim()
    .replace(/^\/?/, "/");

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
  const to = normalizeEmailStrict(email);
  if (!to) throw new Error("invalid_email");
  const requestedDays = parseRequestedDays(days);

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
    days: requestedDays,
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

  const confirmBaseUrl = getDefaultConfirmBaseUrl();
  const confirmUrl = buildConfirmUrl(confirmToken, confirmBaseUrl);

  const CUSTOM_TENANT_FQDN = (() => {
    try {
      return new URL(confirmBaseUrl).hostname || "";
    } catch (_) {
      return String(confirmBaseUrl || "")
        .trim()
        .replace(/^https?:\/\//i, "")
        .replace(/\/.*$/, "");
    }
  })();

  const subjectText =
    String(config.apiCredentialsEmailSubject || "Confirm API key creation").trim() ||
    "Confirm API key creation";
  const subject = `[${CUSTOM_TENANT_FQDN}] ${subjectText} CODE: ${confirmToken} `;

  const lifetimeText = `${requestedDays} day${requestedDays === 1 ? "" : "s"}`;

  const text =
    `API CREDENTIALS REQUEST DETECTED.\n\n` +
    `API KEY TABLE WRITE ATTEMPT.\n` +
    `STATUS: PENDING CONFIRMATION.\n\n` +
    `ACTION\n` +
    `CREATE API KEY\n\n` +
    `REQUESTED EMAIL\n` +
    `${to}\n\n` +
    `API KEY LIFETIME\n` +
    `${lifetimeText.toUpperCase()}\n\n` +
    `CODE\n` +
    `${confirmToken}\n\n` +
    `${confirmUrl} VALID FOR ${ttlMinutes} MINUTES.\n\n` +
    `NO TOKEN, NO API KEY.\n` +
    `UNCONFIRMED REQUESTS ARE DROPPED.\n\n` +
    `---\n` +
    `SYSTEM GENERATED MESSAGE. REPLIES ARE /dev/null.\n\n` +
    `---\n` +
    `POWERED BY HALTMAN.IO & THE HACKER'S CHOICE\n`;

  const html =
    `
<!doctype html>
<html lang=en>
	<head>
		<meta charset=UTF-8>
		<title>API credentials confirmation - Haltman.io</title>
		<meta name=viewport content="width=device-width,initial-scale=1">
	</head>
	<body style=margin:0;padding:0;background-color:#09090b>
		<table width=100% cellpadding=0 cellspacing=0 role=presentation style=background-color:#09090b>
			<tr>
				<td align=center style="padding:36px 14px">
					<table width=100% cellpadding=0 cellspacing=0 role=presentation style=max-width:640px;border-collapse:separate;border-spacing:0>
						<tr>
							<td style="background-color:#09090b;background-image:radial-gradient(600px 220px at 50% 0,rgba(255,255,255,.07),rgba(255,255,255,0) 60%),radial-gradient(520px 240px at 50% 110%,rgba(255,255,255,.05),rgba(255,255,255,0) 60%);padding:0">
								<table width=100% cellpadding=0 cellspacing=0 role=presentation style="background-color:rgba(9,9,11,.82);border:1px solid rgba(255,255,255,.1);border-radius:16px;overflow:hidden;box-shadow:0 18px 60px rgba(0,0,0,.55)">
									<tr>
										<td style="padding:18px 20px 14px;border-bottom:1px solid rgba(255,255,255,.08)">
											<table width=100% cellpadding=0 cellspacing=0 role=presentation>
												<tr>
													<td align=left style=vertical-align:middle>
														<p style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:rgba(255,255,255,.92);letter-spacing:.2px">
															${CUSTOM_TENANT_FQDN}
														</p>
														<p style="margin:4px 0 0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:rgba(255,255,255,.55);line-height:1.35">
															Email Forwarding Service
														</p>
													</td>
													<td align=right style=vertical-align:middle>
														<span style="display:inline-block;padding:6px 10px;border:1px solid rgba(255,255,255,.1);border-radius:999px;background-color:rgba(255,255,255,.04);font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:11px;color:rgba(255,255,255,.7);white-space:nowrap">
														PENDING CONFIRMATION
														</span>
													</td>
												</tr>
											</table>
										</td>
									</tr>
									<tr>
										<td style=padding:20px>
										    <center>
											<p style="margin:0 0 16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:rgba(255,255,255,.62)">
												<strong style=color:rgba(255,255,255,.78);font-weight:600>IGNORE IF THIS WASN'T YOU</strong>.

											</p>
											<p style="margin:0 0 16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:rgba(255,255,255,.62)">
												CONFIRMATION IS REQUIRED TO CREATE A NEW API KEY:
											</p>
											</center>
											<table width=100% cellpadding=0 cellspacing=0 role=presentation style="background-color:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.1);border-radius:14px;overflow:hidden">
												<tr>
													<td style="padding:14px 14px 12px">
														<p style="margin:0 0 6px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:11px;color:rgba(255,255,255,.45);letter-spacing:.2px;text-transform:uppercase">
															Action
														</p>
														<p style="margin:0 0 12px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:13px;color:rgba(255,255,255,.86)">
															CREATE API KEY
														</p>
														<p style="margin:0 0 6px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:11px;color:rgba(255,255,255,.45);letter-spacing:.2px;text-transform:uppercase">
															Requested Email
														</p>
														<p style="margin:0 0 12px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:13px;color:rgba(255,255,255,.86);word-break:break-word">
															${to}
														</p>
														<p style="margin:0 0 6px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:11px;color:rgba(255,255,255,.45);letter-spacing:.2px;text-transform:uppercase">
															API Key Lifetime
														</p>
														<p style="margin:0 0 12px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:13px;color:rgba(255,255,255,.86);word-break:break-word">
															${lifetimeText}
														</p>
														<p style="margin:0 0 6px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:11px;color:rgba(255,255,255,.45);letter-spacing:.2px;text-transform:uppercase">
															CODE
														</p>
														<table width=100% cellpadding=0 cellspacing=0 role=presentation style="margin:0 0 12px">
															<tr>
																<td style="padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background-color:rgba(255,255,255,.04)">
																	<span style="display:block;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:14px;font-weight:700;color:rgba(255,255,255,.92);letter-spacing:1.6px;word-break:break-all">${confirmToken}</span>
																</td>
															</tr>
														</table>
														<table width=100% cellpadding=0 cellspacing=0 role=presentation>
															<tr>
																<td align=left style=vertical-align:middle>
																	<p style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:rgba(255,255,255,.55)">
																		<a href=${confirmUrl} style="color:rgba(255,255,255,.8);text-decoration:underline;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:12px">${confirmUrl}</a>
																		VALID FOR
																		<strong style=color:rgba(255,255,255,.78);font-weight:600>
																		${ttlMinutes}
																		</strong> MINUTES.
																	</p>
																	<p style="margin:16px 0 0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:rgba(255,255,255,.55)"></p>
																</td>
															</tr>
														</table>
													</td>
												</tr>
											</table>
											<center>
											<p style="margin:16px 0 0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:rgba(255,255,255,.55)">
												SYSTEM GENERATED MESSAGE. REPLIES ARE /dev/null.
											</p>
											</center>
										</td>
									</tr>
									<tr>
										<td style="padding:14px 20px 18px;border-top:1px solid rgba(255,255,255,.08)"><center>
											<p style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:11px;line-height:1.6;color:rgba(255,255,255,.42)">
												POWERED BY <strong style=color:rgba(255,255,255,.78);font-weight:600>HALTMAN.IO</strong> & <strong style=color:rgba(255,255,255,.78);font-weight:600>THE HACKER'S CHOICE</strong>
											</p></center>
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
    ttl_minutes: ttlMinutes,
    pending: result.pending || null,
    action: result.action || "created",
  };
}

module.exports = { sendApiTokenRequestEmail, sha256Buffer };
