import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer from "nodemailer";

import { AppLogger } from "../../../shared/logging/app-logger.service.js";
import { buildEmailSubject } from "../../../shared/utils/email-subject-template.js";
import { generateConfirmationCode } from "../../../shared/utils/confirmation-code.js";
import { sha256Buffer } from "../../../shared/utils/crypto.js";
import { normalizeDomainTarget } from "../../../shared/validation/domain-target.js";
import { DomainRepository } from "../../domains/domain.repository.js";
import { EmailConfirmationsRepository } from "../repositories/email-confirmations.repository.js";

interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  authEnabled: boolean;
  user: string;
  pass: string;
  from: string;
  heloName: string;
  tlsRejectUnauthorized: boolean;
}

interface ForwardingSettings {
  confirmEndpoint: string;
  emailConfirmationTtlMinutes: number;
  emailConfirmationResendCooldownSeconds: number;
  emailSubject: string;
  emailSubjectSubscribe: string;
  emailSubjectUnsubscribe: string;
}

export interface SendConfirmationResult {
  ok: boolean;
  sent: boolean;
  reason?: string;
  ttl_minutes: number;
}

const DOMAINS_CACHE_TTL_MS = 10_000;

@Injectable()
export class EmailConfirmationService {
  private domainsCache: { at: number; data: Set<string> | null } = { at: 0, data: null };

  constructor(
    private readonly configService: ConfigService,
    private readonly emailConfirmationsRepository: EmailConfirmationsRepository,
    private readonly domainRepository: DomainRepository,
    private readonly logger: AppLogger,
  ) {}

  async sendEmailConfirmation(payload: {
    email: string;
    requestIpText: string | undefined;
    userAgent: string;
    aliasName: string;
    aliasDomain: string;
    intent?: string;
    requestOrigin?: string;
    requestReferer?: string;
  }): Promise<SendConfirmationResult> {
    const to = this.normalizeEmailStrict(payload.email);
    if (!to) throw new Error("invalid_email");

    const forwardingSettings =
      this.configService.getOrThrow<ForwardingSettings>("forwarding");

    const ttlMinRaw = Number(forwardingSettings.emailConfirmationTtlMinutes ?? 10);
    const ttlMinutes = Number.isFinite(ttlMinRaw) && ttlMinRaw > 0 ? ttlMinRaw : 10;

    const cooldownSecRaw = Number(forwardingSettings.emailConfirmationResendCooldownSeconds ?? 60);
    const cooldownSeconds = Number.isFinite(cooldownSecRaw) && cooldownSecRaw >= 0 ? cooldownSecRaw : 60;

    const pending = await this.emailConfirmationsRepository.getActivePendingByEmail(to);

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
      payload.requestIpText && typeof payload.requestIpText === "string"
        ? payload.requestIpText
        : null;

    const intentNormalized = payload.intent ? this.assertIntent(payload.intent) : "subscribe";

    if (pending) {
      await this.emailConfirmationsRepository.rotateTokenForPending({
        email: to,
        tokenHash32,
        ttlMinutes,
        requestIpStringOrNull,
        userAgentOrNull: payload.userAgent || "",
      });
    } else {
      await this.emailConfirmationsRepository.createPending({
        email: to,
        tokenHash32,
        ttlMinutes,
        requestIpStringOrNull,
        userAgentOrNull: payload.userAgent || "",
        intent: intentNormalized,
        aliasName: payload.aliasName,
        aliasDomain: payload.aliasDomain,
      });
    }

    const confirmBaseUrl = await this.resolveConfirmBaseUrl({
      requestOrigin: payload.requestOrigin,
      requestReferer: payload.requestReferer,
    });
    const confirmUrl = this.buildConfirmUrl(
      token,
      confirmBaseUrl,
      forwardingSettings.confirmEndpoint,
    );

    const smtpSettings = this.configService.getOrThrow<SmtpSettings>("smtp");
    const from = String(smtpSettings.from || "").trim();
    if (!from) throw new Error("missing_SMTP_FROM");

    const tenantFqdn = this.extractHostname(confirmBaseUrl);

    const subjectTemplate =
      intentNormalized === "unsubscribe"
        ? forwardingSettings.emailSubjectUnsubscribe || forwardingSettings.emailSubject
        : forwardingSettings.emailSubjectSubscribe || forwardingSettings.emailSubject || "Confirm your email";

    const subject = buildEmailSubject({
      template: subjectTemplate,
      host: tenantFqdn,
      code: token,
    });

    const actionLabel = intentNormalized === "unsubscribe" ? "DELETE" : "CREATE";
    const actionSql =
      intentNormalized === "unsubscribe"
        ? `DELETE FROM aliases WHERE alias='${payload.aliasName}@${payload.aliasDomain}';`
        : `INSERT INTO aliases (alias, destination) VALUES ('${payload.aliasName}@${payload.aliasDomain}', '${to}');`;

    const text = this.buildPlainText(token, ttlMinutes, actionLabel, actionSql, payload.aliasName, payload.aliasDomain, confirmUrl);
    const html = this.buildHtml(tenantFqdn, token, ttlMinutes, actionSql, confirmUrl);

    const transporter = this.createTransport(smtpSettings);
    await transporter.sendMail({ from, to, subject, text, html });

    return { ok: true, sent: true, ttl_minutes: ttlMinutes };
  }

  private normalizeEmailStrict(email: string): string {
    if (typeof email !== "string") return "";
    return email.trim().toLowerCase();
  }

  private assertIntent(intent: string): string {
    if (typeof intent !== "string") throw new Error("invalid_intent");
    const value = intent.trim().toLowerCase();
    if (!value || value.length > 32) throw new Error("invalid_intent");
    return value;
  }

  private getDefaultConfirmBaseUrl(): string {
    const appSettings = this.configService.getOrThrow<{ publicUrl: string }>("app");
    const base = String(appSettings.publicUrl || "").trim().replace(/\/+$/, "");
    if (!base) throw new Error("missing_APP_PUBLIC_URL");
    return base;
  }

  private parseHeaderOriginCandidate(raw: string | undefined | null): { origin: string; domain: string } | null {
    if (typeof raw !== "string") return null;
    const value = raw.trim();
    if (!value) return null;

    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

      const normalized = normalizeDomainTarget(parsed.hostname);
      if (!normalized.ok) return null;

      return { origin: parsed.origin.replace(/\/+$/, ""), domain: normalized.value };
    } catch {
      return null;
    }
  }

  private async getActiveDomainSetCached(): Promise<Set<string>> {
    const now = Date.now();
    if (this.domainsCache.data && now - this.domainsCache.at < DOMAINS_CACHE_TTL_MS) {
      return this.domainsCache.data;
    }

    const names = await this.domainRepository.listActiveNames();
    const set = new Set<string>();

    for (const name of names) {
      const normalized = normalizeDomainTarget(name);
      if (normalized.ok) set.add(normalized.value);
    }

    this.domainsCache = { at: now, data: set };
    return set;
  }

  private async resolveConfirmBaseUrl(headers: {
    requestOrigin?: string | undefined;
    requestReferer?: string | undefined;
  }): Promise<string> {
    const fallback = this.getDefaultConfirmBaseUrl();

    try {
      const candidates = [headers.requestOrigin, headers.requestReferer]
        .map((value) => this.parseHeaderOriginCandidate(value))
        .filter((c): c is { origin: string; domain: string } => c !== null);

      if (candidates.length === 0) return fallback;

      const activeDomains = await this.getActiveDomainSetCached();
      for (const candidate of candidates) {
        if (activeDomains.has(candidate.domain)) {
          return candidate.origin;
        }
      }
    } catch {
      return fallback;
    }

    return fallback;
  }

  private buildConfirmUrl(token: string, baseUrl: string, endpoint: string): string {
    const base = String(baseUrl || "").trim().replace(/\/+$/, "") || this.getDefaultConfirmBaseUrl();
    const ep = String(endpoint || "/forward/confirm")
      .trim()
      .replace(/^\/?/, "/");

    return `${base}${ep}?token=${encodeURIComponent(token)}`;
  }

  private extractHostname(url: string): string {
    try {
      return new URL(url).hostname || "";
    } catch {
      return String(url || "")
        .trim()
        .replace(/^https?:\/\//i, "")
        .replace(/\/.*$/, "");
    }
  }

  private createTransport(settings: SmtpSettings): nodemailer.Transporter {
    if (!settings.host) throw new Error("missing_SMTP_HOST");

    return nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth: settings.authEnabled
        ? { user: String(settings.user || ""), pass: String(settings.pass || "") }
        : undefined,
      name: settings.heloName || undefined,
      tls: {
        rejectUnauthorized: settings.tlsRejectUnauthorized,
      },
    });
  }

  private buildPlainText(
    token: string,
    ttlMinutes: number,
    actionLabel: string,
    actionSql: string,
    aliasName: string,
    aliasDomain: string,
    confirmUrl: string,
  ): string {
    return (
      `YOUR VERIFICATION CODE IS: ${token}\n` +
      `EXPIRES IN ${ttlMinutes} MINUTES.\n\n` +
      `ALIAS MODIFICATION REQUEST DETECTED.\n` +
      `STATUS: PENDING CONFIRMATION.\n\n` +
      `ACTION\n` +
      `${actionLabel.toUpperCase()}\n\n` +
      `ALIAS\n` +
      `${aliasName}@${aliasDomain}\n\n` +
      `CONFIRM LINK\n` +
      `${confirmUrl}\n\n` +
      `IGNORE IF THIS WASN'T YOU.\n` +
      `NO TOKEN, NO CHANGE.\n` +
      `UNCONFIRMED REQUESTS ARE DROPPED.\n\n` +
      `---\n` +
      `SYSTEM GENERATED MESSAGE. REPLIES ARE /dev/null.\n` +
      `POWERED BY HALTMAN.IO & THE HACKER'S CHOICE\n`
    );
  }

  private buildHtml(
    tenantFqdn: string,
    token: string,
    ttlMinutes: number,
    actionSql: string,
    confirmUrl: string,
  ): string {
    return `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${tenantFqdn}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <meta name="supported-color-schemes" content="dark" />
  </head>

  <body style="margin:0;padding:0;background-color:#09090b;">
    <!-- Preheader (hidden) - helps iOS/Mail OTP heuristics -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">
      Your verification code is ${token}. Use it to confirm this request. Expires in ${ttlMinutes} minutes.
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
                  <!-- HEADER -->
                  <tr>
                    <td style="padding:18px 20px 14px;border-bottom:1px solid rgba(255,255,255,.08);">
                      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                        <tr>
                          <td align="left" style="vertical-align:middle;">
                            <p style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:rgba(255,255,255,.92);letter-spacing:.2px;">
                              ${tenantFqdn}
                            </p>
                            <p style="margin:4px 0 0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:rgba(255,255,255,.55);line-height:1.35;">
                              Email Forwarding Service
                            </p>
                          </td>
                          <td align="right" style="vertical-align:middle;">
                            <span
                              style="display:inline-block;padding:6px 10px;border:1px solid rgba(255,255,255,.1);border-radius:999px;background-color:rgba(255,255,255,.04);font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:11px;color:rgba(255,255,255,.7);white-space:nowrap;"
                            >
                              PENDING CONFIRMATION
                            </span>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- MAIN -->
                  <tr>
                    <td style="padding:20px;">
                      <!-- OTP-friendly block: keep it very simple, near top, nothing between label and code -->
                      <p style="margin:0 0 10px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:rgba(255,255,255,.86);">
                        Your verification code is:
                      </p>

                      <p
                        style="margin:0 0 14px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:22px;font-weight:800;color:rgba(255,255,255,.92);letter-spacing:2.2px;"
                        aria-label="Verification code"
                      >
                        ${token}
                      </p>

                      <p style="margin:0 0 14px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:rgba(255,255,255,.62);">
                        Use this code to confirm the request. Expires in
                        <strong style="color:rgba(255,255,255,.78);font-weight:600;">${ttlMinutes}</strong>
                        minutes.
                        <strong style="color:rgba(255,255,255,.78);font-weight:600;">IGNORE IF THIS WASN'T YOU</strong>.
                      </p>

                      <!-- Link comes after the OTP instructions (helps OTP heuristics) -->
                      <p style="margin:0 0 16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:rgba(255,255,255,.55);">
                        Confirm link:
                        <a
                          href="${confirmUrl}"
                          style="color:rgba(255,255,255,.8);text-decoration:underline;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:12px;"
                        >${confirmUrl}</a>
                      </p>

                      <p style="margin:0 0 16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:rgba(255,255,255,.62);">
                        SYSTEM GENERATED MESSAGE. REPLIES ARE /dev/null.
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
                            <p style="margin:0 0 6px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:11px;color:rgba(255,255,255,.45);letter-spacing:.2px;text-transform:uppercase;">
                              Action
                            </p>

                            <!-- Render as code block for semantics without changing the content -->
                            <pre
                              style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:12px;line-height:1.5;color:rgba(255,255,255,.86);white-space:pre-wrap;word-break:break-word;"
                            ><code>${actionSql}</code></pre>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- FOOTER -->
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
  }
}
