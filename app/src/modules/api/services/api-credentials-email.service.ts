import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer from "nodemailer";

import { AppLogger } from "../../../shared/logging/app-logger.service.js";
import { normalizeEmailStrict } from "../../../shared/utils/auth-identifiers.js";
import { buildEmailSubject } from "../../../shared/utils/email-subject-template.js";
import { packIp16 } from "../../../shared/utils/ip-pack.js";
import { renderSecurityEmail } from "../../../shared/utils/security-email-template.js";
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
    const to = normalizeEmailStrict(payload.email);
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
      `YOUR CONFIRMATION TOKEN IS: ${confirmToken}\n` +
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
    return renderSecurityEmail({
      tenantFqdn,
      preheader: `Token: ${confirmToken}. Expires in ${ttlMinutes} minutes.`,
      sectionLabel: "Security Verification",
      tokenLabel: "Confirmation Token",
      token: confirmToken,
      detailsHeading: "Action Details",
      details: [
        { label: "Mutation", value: actionSql },
        { label: "API Key Lifetime", value: lifetimeText.toUpperCase() },
      ],
      ttlMinutes,
      ttlPrefix: "This request expires in",
      paragraphs: [
        "Confirm this API key issuance only if you started the request.",
        "Ignore this email if you did not request it. No token, no API key.",
      ],
      cta: {
        href: confirmUrl,
        label: "Confirm Action ->",
      },
    });
  }
}
