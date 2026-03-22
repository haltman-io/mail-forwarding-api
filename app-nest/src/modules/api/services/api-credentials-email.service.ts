import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer from "nodemailer";

import { AppLogger } from "../../../shared/logging/app-logger.service.js";
import { buildEmailSubject } from "../../../shared/utils/email-subject-template.js";
import { packIp16 } from "../../../shared/utils/ip-pack.js";
import {
  ApiTokenRequestsRepository,
  type PendingMeta,
} from "../repositories/api-token-requests.repository.js";

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

interface ApiCredentialsSettings {
  confirmEndpoint: string;
  emailTtlMinutes: number;
  emailResendCooldownSeconds: number;
  emailMaxSends: number;
  emailSubjectTemplate: string;
}

export interface SendResult {
  ok: boolean;
  sent: boolean;
  reason?: string;
  ttl_minutes: number;
  pending: PendingMeta | null;
  action?: string;
}

@Injectable()
export class ApiCredentialsEmailService {
  constructor(
    private readonly configService: ConfigService,
    private readonly apiTokenRequestsRepository: ApiTokenRequestsRepository,
    private readonly logger: AppLogger,
  ) {}

  async sendApiTokenRequestEmail(payload: {
    email: string;
    days: number;
    requestIpText: string | undefined;
    userAgent: string;
  }): Promise<SendResult> {
    const to = this.normalizeEmailStrict(payload.email);
    if (!to) throw new Error("invalid_email");

    const requestedDays = this.parseRequestedDays(payload.days);

    const credentialsSettings =
      this.configService.getOrThrow<ApiCredentialsSettings>("apiCredentials");

    const ttlMinRaw = Number(credentialsSettings.emailTtlMinutes ?? 15);
    const ttlMinutes = Number.isFinite(ttlMinRaw) && ttlMinRaw > 0 ? ttlMinRaw : 15;

    const cooldownSecRaw = Number(credentialsSettings.emailResendCooldownSeconds ?? 60);
    const cooldownSeconds =
      Number.isFinite(cooldownSecRaw) && cooldownSecRaw >= 0 ? cooldownSecRaw : 60;

    const maxSendRaw = Number(credentialsSettings.emailMaxSends ?? 3);
    const maxSendCount = Number.isFinite(maxSendRaw) && maxSendRaw > 0 ? maxSendRaw : 3;

    const requestIpPacked = payload.requestIpText ? packIp16(payload.requestIpText) : null;
    const ua = String(payload.userAgent || "").slice(0, 255);

    const result = await this.apiTokenRequestsRepository.upsertPendingByEmailTx({
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
        pending: result.pending ?? null,
      };
    }

    const confirmToken = result.token_plain;
    if (!confirmToken) throw new Error("missing_token_plain");

    const smtpSettings = this.configService.getOrThrow<SmtpSettings>("smtp");
    const from = String(smtpSettings.from || "").trim();
    if (!from) throw new Error("missing_SMTP_FROM");

    const appSettings = this.configService.getOrThrow<{ publicUrl: string }>("app");
    const confirmBaseUrl = String(appSettings.publicUrl || "").trim().replace(/\/+$/, "");
    if (!confirmBaseUrl) throw new Error("missing_APP_PUBLIC_URL");

    const confirmUrl = this.buildConfirmUrl(
      confirmToken,
      confirmBaseUrl,
      credentialsSettings.confirmEndpoint,
    );

    const tenantFqdn = this.extractHostname(confirmBaseUrl);

    const subject = buildEmailSubject({
      template: credentialsSettings.emailSubjectTemplate,
      host: tenantFqdn,
      code: confirmToken,
    });

    const lifetimeText = `${requestedDays} day${requestedDays === 1 ? "" : "s"}`;
    const actionSql = `API_Key CREATE ${to}`;

    const text = this.buildPlainText(confirmToken, ttlMinutes, actionSql, lifetimeText, confirmUrl);
    const html = this.buildHtml(
      tenantFqdn,
      confirmToken,
      ttlMinutes,
      actionSql,
      lifetimeText,
      confirmUrl,
    );

    const transporter = this.createTransport(smtpSettings);
    await transporter.sendMail({ from, to, subject, text, html });

    return {
      ok: true,
      sent: true,
      ttl_minutes: ttlMinutes,
      pending: result.pending ?? null,
      action: result.action || "created",
    };
  }

  private normalizeEmailStrict(email: string): string {
    if (typeof email !== "string") return "";
    return email.trim().toLowerCase();
  }

  private parseRequestedDays(days: number): number {
    const num = Number(days);
    if (!Number.isInteger(num) || num <= 0 || num > 90) return 1;
    return num;
  }

  private buildConfirmUrl(token: string, baseUrl: string, endpoint: string): string {
    const ep = String(endpoint || "/api/credentials/confirm")
      .trim()
      .replace(/^\/?/, "/");
    return `${baseUrl}${ep}?token=${encodeURIComponent(token)}`;
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
    confirmToken: string,
    ttlMinutes: number,
    actionSql: string,
    lifetimeText: string,
    confirmUrl: string,
  ): string {
    return (
      `YOUR VERIFICATION CODE IS: ${confirmToken}\n` +
      `EXPIRES IN ${ttlMinutes} MINUTES.\n\n` +
      `API CREDENTIALS REQUEST DETECTED.\n` +
      `STATUS: PENDING CONFIRMATION.\n\n` +
      `ACTION\n` +
      `${actionSql}\n\n` +
      `API KEY LIFETIME\n` +
      `${lifetimeText.toUpperCase()}\n\n` +
      `CONFIRM LINK\n` +
      `${confirmUrl}\n\n` +
      `IGNORE IF THIS WASN'T YOU.\n` +
      `NO TOKEN, NO API KEY.\n` +
      `UNCONFIRMED REQUESTS ARE DROPPED.\n\n` +
      `---\n` +
      `SYSTEM GENERATED MESSAGE. REPLIES ARE /dev/null.\n` +
      `POWERED BY HALTMAN.IO & THE HACKER'S CHOICE\n`
    );
  }

  private buildHtml(
    tenantFqdn: string,
    confirmToken: string,
    ttlMinutes: number,
    actionSql: string,
    lifetimeText: string,
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
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">
      Your verification code is ${confirmToken}. Use it to confirm this request. Expires in ${ttlMinutes} minutes.
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

                  <tr>
                    <td style="padding:20px;">
                      <p style="margin:0 0 10px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:rgba(255,255,255,.86);">
                        Your verification code is:
                      </p>

                      <p
                        style="margin:0 0 14px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:22px;font-weight:800;color:rgba(255,255,255,.92);letter-spacing:2.2px;"
                        aria-label="Verification code"
                      >
                        ${confirmToken}
                      </p>

                      <p style="margin:0 0 14px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:rgba(255,255,255,.62);">
                        Use this code to confirm the request. Expires in
                        <strong style="color:rgba(255,255,255,.78);font-weight:600;">${ttlMinutes}</strong>
                        minutes.
                        <strong style="color:rgba(255,255,255,.78);font-weight:600;">IGNORE IF THIS WASN'T YOU</strong>.
                      </p>

                      <p style="margin:0 0 16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:rgba(255,255,255,.55);">
                        Confirm link:
                        <a
                          href="${confirmUrl}"
                          style="color:rgba(255,255,255,.8);text-decoration:underline;word-break:break-all;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:12px;"
                        >${confirmUrl}</a>
                      </p>

                      <p style="margin:0 0 16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:rgba(255,255,255,.62);">
                        API key lifetime: <strong style="color:rgba(255,255,255,.78);font-weight:600;">${lifetimeText.toUpperCase()}</strong><br />
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
                            <pre
                              style="margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:12px;line-height:1.5;color:rgba(255,255,255,.86);white-space:pre-wrap;word-break:break-word;"
                            ><code>${actionSql}</code></pre>
                          </td>
                        </tr>
                      </table>
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
  }
}
