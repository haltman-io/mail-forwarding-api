"use strict";

/**
 * @fileoverview Email confirmation workflow (token + DB + SMTP).
 */

const crypto = require("crypto");
const nodemailer = require("nodemailer");

const { config } = require("../config");
const { emailConfirmationsRepository } = require("../repositories/email-confirmations-repository");
const { domainRepository } = require("../repositories/domain-repository");
const { normalizeDomainTarget } = require("../lib/domain-validation");

const DOMAINS_CACHE_TTL_MS = 10_000;
const { generateConfirmationCode } = require("../lib/confirmation-code");

let domainsCache = { at: 0, data: null };

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

function getDefaultConfirmBaseUrl() {
  const base = String(config.appPublicUrl || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("missing_APP_PUBLIC_URL");
  return base;
}

/**
 * Parse and validate an incoming URL header (Origin/Referer).
 * @param {string | undefined | null} raw
 * @returns {{ origin: string, domain: string } | null}
 */
function parseHeaderOriginCandidate(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value) return null;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

    const normalized = normalizeDomainTarget(parsed.hostname);
    if (!normalized.ok || !normalized.value) return null;

    return { origin: parsed.origin.replace(/\/+$/, ""), domain: normalized.value };
  } catch (_) {
    return null;
  }
}

/**
 * @returns {Promise<Set<string>>}
 */
async function getActiveDomainSetCached() {
  const now = Date.now();
  if (domainsCache.data && now - domainsCache.at < DOMAINS_CACHE_TTL_MS) {
    return domainsCache.data;
  }

  const names = await domainRepository.listActiveNames();
  const set = new Set();

  for (const name of names) {
    const normalized = normalizeDomainTarget(name);
    if (normalized.ok && normalized.value) set.add(normalized.value);
  }

  domainsCache = { at: now, data: set };
  return set;
}

/**
 * Resolve the base URL to be used in confirmation links.
 * Falls back to APP_PUBLIC_URL on any failure.
 * @param {{ requestOrigin?: string, requestReferer?: string }} headers
 * @returns {Promise<string>}
 */
async function resolveConfirmBaseUrl({ requestOrigin, requestReferer }) {
  const fallback = getDefaultConfirmBaseUrl();

  try {
    const candidates = [requestOrigin, requestReferer]
      .map((value) => parseHeaderOriginCandidate(value))
      .filter(Boolean);

    if (candidates.length === 0) return fallback;

    const activeDomains = await getActiveDomainSetCached();
    for (const candidate of candidates) {
      if (activeDomains.has(candidate.domain)) {
        return candidate.origin;
      }
    }
  } catch (_) {
    return fallback;
  }

  return fallback;
}

/**
 * @param {string} token
 * @param {string} [baseUrl]
 * @returns {string}
 */
function buildConfirmUrl(token, baseUrl) {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "") || getDefaultConfirmBaseUrl();
  const endpoint = String(config.emailConfirmEndpoint || "/forward/confirm")
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
 * @param {string} [payload.requestOrigin]
 * @param {string} [payload.requestReferer]
 * @returns {Promise<{ ok: boolean, sent: boolean, reason?: string, ttl_minutes: number }>}
 */
async function sendEmailConfirmation({
  email,
  requestIpText,
  userAgent,
  aliasName,
  aliasDomain,
  intent,
  requestOrigin,
  requestReferer,
}) {
  const to = normalizeEmailStrict(email);
  if (!to) throw new Error("invalid_email");

  const ttlMin = Number(config.emailConfirmationTtlMinutes ?? 10);
  const ttlMinutes = Number.isFinite(ttlMin) && ttlMin > 0 ? ttlMin : 10;
  const ttlMinutesInt = ttlMinutes;

  const cooldownSec = Number(config.emailConfirmationResendCooldownSeconds ?? 60);
  const cooldownSeconds = Number.isFinite(cooldownSec) && cooldownSec >= 0 ? cooldownSec : 60;

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

  const token = generateConfirmationCode();
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

  const confirmBaseUrl = await resolveConfirmBaseUrl({
    requestOrigin,
    requestReferer,
  });
  const confirmUrl = buildConfirmUrl(token, confirmBaseUrl);

  const from = String(config.smtpFrom || "").trim();
  if (!from) throw new Error("missing_SMTP_FROM");

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

  const subject_text =
    intentNormalized === "unsubscribe"
      ? config.emailConfirmationSubjectUnsubscribe || config.emailConfirmationSubject
      : config.emailConfirmationSubjectSubscribe || config.emailConfirmationSubject || "Confirm your email";

  const subject = `[${CUSTOM_TENANT_FQDN}] ${subject_text} CODE: ${token} `;

  const actionLabel =
    intentNormalized === "unsubscribe" ? "DELETE" : "CREATE";

  const text =
  `ALIAS MODIFICATION REQUEST DETECTED.\n\n` +
  `MAIL ALIAS TABLE WRITE ATTEMPT.\n` +
  `STATUS: PENDING CONFIRMATION.\n\n` +
  `ACTION\n` +
  `${actionLabel.toUpperCase()}\n\n` +
  `ALIAS\n` +
  `${aliasName}@${aliasDomain}\n\n` +
  `CODE\n` +
  `${token}\n\n` +
  `${confirmUrl} VALID FOR ${ttlMinutes} MINUTES.\n\n` +
  `NO TOKEN, NO CHANGE.\n` +
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
		<title>Action confirmation — Haltman.io</title>
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
												CONFIRMATION IS REQUIRED TO PROCEED WITH:
											</p>
											</center>
											<table width=100% cellpadding=0 cellspacing=0 role=presentation style="background-color:rgba(0,0,0,.28);border:1px solid rgba(255,255,255,.1);border-radius:14px;overflow:hidden">
												<tr>
													<td style="padding:14px 14px 12px">
														<p style="margin:0 0 6px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:11px;color:rgba(255,255,255,.45);letter-spacing:.2px;text-transform:uppercase">
															Action
														</p>
														<p style="margin:0 0 12px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:13px;color:rgba(255,255,255,.86)">
															${intentNormalized === "unsubscribe" ? "DELETE" : "CREATE"}
														</p>
														<p style="margin:0 0 6px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:11px;color:rgba(255,255,255,.45);letter-spacing:.2px;text-transform:uppercase">
															alias
														</p>
														<p style="margin:0 0 12px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:13px;color:rgba(255,255,255,.86);word-break:break-word">
															${aliasName}@${aliasDomain}
														</p>
														<p style="margin:0 0 6px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:11px;color:rgba(255,255,255,.45);letter-spacing:.2px;text-transform:uppercase">
															CODE
														</p>
														<table width=100% cellpadding=0 cellspacing=0 role=presentation style="margin:0 0 12px">
															<tr>
																<td style="padding:10px 12px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background-color:rgba(255,255,255,.04)">
																	<span style="display:block;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:14px;font-weight:700;color:rgba(255,255,255,.92);letter-spacing:1.6px;word-break:break-all">${token}</span>
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

  return { ok: true, sent: true, to, ttl_minutes: ttlMinutes };
}

module.exports = {
  sendEmailConfirmation,
  generateConfirmationCode,
  sha256Buffer,
  buildConfirmUrl,
  resolveConfirmBaseUrl,
};
