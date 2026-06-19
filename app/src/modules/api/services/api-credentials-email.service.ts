import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer from "nodemailer";

import { AppLogger } from "../../../shared/logging/app-logger.service.js";
import { normalizeEmailStrict } from "../../../shared/utils/auth-identifiers.js";
import { buildEmailSubject } from "../../../shared/utils/email-subject-template.js";
import { packIp16 } from "../../../shared/utils/ip-pack.js";
import {
  renderSecurityEmail,
  type SecurityEmailDetail,
} from "../../../shared/utils/security-email-template.js";
import {
  ApiTokenRequestsRepository,
  type ApiTokenRequestAction,
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
    action?: ApiTokenRequestAction;
    days?: number;
    automaticRenew?: boolean;
    requestIpText: string | undefined;
    userAgent: string;
  }): Promise<SendResult> {
    const to = normalizeEmailStrict(payload.email);
    if (!to) throw new Error("invalid_email");

    const action = payload.action ?? "create";
    const requestedDays = action === "create" ? this.parseRequestedDays(payload.days) : 1;
    const automaticRenew = Boolean(payload.automaticRenew);

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
      action,
      days: requestedDays,
      automaticRenew,
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

    const actionSql = this.buildActionLine(action, to);
    const details = this.buildActionDetails(action, to, requestedDays, automaticRenew);

    const text = this.buildPlainText(confirmToken, ttlMinutes, actionSql, details, confirmUrl);
    const html = this.buildHtml(
      tenantFqdn,
      confirmToken,
      ttlMinutes,
      actionSql,
      details,
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

  async sendApiTokenDestroyedEmail(payload: {
    email: string;
    requestIpText: string | undefined;
    userAgent: string;
  }): Promise<void> {
    const to = normalizeEmailStrict(payload.email);
    if (!to) throw new Error("invalid_email");

    const smtpSettings = this.configService.getOrThrow<SmtpSettings>("smtp");
    const from = String(smtpSettings.from || "").trim();
    if (!from) throw new Error("missing_SMTP_FROM");

    const appSettings = this.configService.getOrThrow<{ publicUrl: string }>("app");
    const confirmBaseUrl = String(appSettings.publicUrl || "").trim().replace(/\/+$/, "");
    if (!confirmBaseUrl) throw new Error("missing_APP_PUBLIC_URL");

    const tenantFqdn = this.extractHostname(confirmBaseUrl);
    const details: SecurityEmailDetail[] = [
      { label: "Mutation", value: `API_Key DESTROY ${to}` },
      { label: "Owner Email", value: to },
    ];
    if (payload.requestIpText) {
      details.push({ label: "Request IP", value: payload.requestIpText });
    }

    const subject = `API key destroyed | ${tenantFqdn}`;
    const text = this.buildNotificationPlainText(details);
    const html = renderSecurityEmail({
      tenantFqdn,
      preheader: "An API key linked to this email was destroyed.",
      sectionLabel: "Security Notification",
      detailsHeading: "Action Details",
      details,
      paragraphs: [
        "An API key linked to this email address was destroyed.",
        "If you did not start this action, create a new key and review your account access.",
      ],
    });

    const transporter = this.createTransport(smtpSettings);
    await transporter.sendMail({ from, to, subject, text, html });
  }

  private parseRequestedDays(days: unknown): number {
    const num = Number(days);
    if (!Number.isInteger(num) || num <= 0 || num > 9999) return 1;
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
    details: SecurityEmailDetail[],
    confirmUrl: string,
  ): string {
    const detailText = details
      .map((detail) => `${detail.label.toUpperCase()}\n${detail.value}`)
      .join("\n\n");

    return (
      `YOUR CONFIRMATION TOKEN IS: ${confirmToken}\n` +
      `EXPIRES IN ${ttlMinutes} MINUTES.\n\n` +
      `API CREDENTIALS REQUEST DETECTED.\n` +
      `STATUS: PENDING CONFIRMATION.\n\n` +
      `ACTION\n` +
      `${actionSql}\n\n` +
      `${detailText}\n\n` +
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

  private buildNotificationPlainText(details: SecurityEmailDetail[]): string {
    const detailText = details
      .map((detail) => `${detail.label.toUpperCase()}\n${detail.value}`)
      .join("\n\n");

    return (
      `API KEY SECURITY NOTIFICATION.\n\n` +
      `${detailText}\n\n` +
      `IF THIS WASN'T YOU, CREATE A NEW KEY AND REVIEW YOUR ACCESS.\n\n` +
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
    details: SecurityEmailDetail[],
    confirmUrl: string,
  ): string {
    return renderSecurityEmail({
      tenantFqdn,
      preheader: `Token: ${confirmToken}. Expires in ${ttlMinutes} minutes.`,
      sectionLabel: "Security Verification",
      tokenLabel: "Confirmation Token",
      token: confirmToken,
      detailsHeading: "Action Details",
      details: [{ label: "Mutation", value: actionSql }, ...details],
      ttlMinutes,
      ttlPrefix: "This request expires in",
      paragraphs: [
        "Confirm this API credentials action only if you started the request.",
        "Ignore this email if you did not request it. No token, no action.",
      ],
      cta: {
        href: confirmUrl,
        label: "Confirm Action ->",
      },
    });
  }

  private buildActionLine(action: ApiTokenRequestAction, email: string): string {
    if (action === "list") return `API_Key LIST ${email}`;
    if (action === "destroy_all") return `API_Key DESTROY_ALL ${email}`;
    return `API_Key CREATE ${email}`;
  }

  private buildActionDetails(
    action: ApiTokenRequestAction,
    email: string,
    days: number,
    automaticRenew: boolean,
  ): SecurityEmailDetail[] {
    if (action === "list") {
      return [
        { label: "Owner Email", value: email },
        { label: "Requested Data", value: "Active API key metadata" },
      ];
    }

    if (action === "destroy_all") {
      return [
        { label: "Owner Email", value: email },
        { label: "Scope", value: "All API keys linked to this email" },
      ];
    }

    const lifetimeText = `${days} day${days === 1 ? "" : "s"}`;
    return [
      { label: "API Key Lifetime", value: lifetimeText.toUpperCase() },
      { label: "Automatic Renew", value: automaticRenew ? "ENABLED" : "DISABLED" },
    ];
  }
}
