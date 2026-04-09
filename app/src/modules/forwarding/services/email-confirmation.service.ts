import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer from "nodemailer";

import { TenantOriginPolicyService } from "../../../shared/tenancy/tenant-origin-policy.service.js";
import { normalizeOriginInput } from "../../../shared/tenancy/origin.utils.js";
import { normalizeEmailStrict } from "../../../shared/utils/auth-identifiers.js";
import { buildEmailSubject } from "../../../shared/utils/email-subject-template.js";
import { generateConfirmationCode } from "../../../shared/utils/confirmation-code.js";
import { sha256Buffer } from "../../../shared/utils/crypto.js";
import { PERMANENT_ALIAS_GOTO } from "../../../shared/utils/alias-policy.js";
import { renderSecurityEmail } from "../../../shared/utils/security-email-template.js";
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
  emailSubjectHandleSubscribe: string;
  emailSubjectHandleUnsubscribe: string;
}

export interface SendConfirmationResult {
  ok: boolean;
  sent: boolean;
  reason?: string;
  ttl_minutes: number;
}

@Injectable()
export class EmailConfirmationService {
  constructor(
    private readonly configService: ConfigService,
    private readonly emailConfirmationsRepository: EmailConfirmationsRepository,
    private readonly originPolicy: TenantOriginPolicyService,
  ) {}

  async sendEmailConfirmation(payload: {
    email: string;
    requestIpText: string | undefined;
    userAgent: string;
    aliasName: string;
    aliasDomain: string;
    aliasDisplay?: string;
    intent?: string;
    confirmEndpoint?: string;
    requestOrigin?: string;
    requestReferer?: string;
  }): Promise<SendConfirmationResult> {
    const to = normalizeEmailStrict(payload.email);
    if (!to) throw new Error("invalid_email");

    const forwardingSettings =
      this.configService.getOrThrow<ForwardingSettings>("forwarding");

    const ttlMinRaw = Number(forwardingSettings.emailConfirmationTtlMinutes ?? 10);
    const ttlMinutes = Number.isFinite(ttlMinRaw) && ttlMinRaw > 0 ? ttlMinRaw : 10;

    const cooldownSecRaw = Number(forwardingSettings.emailConfirmationResendCooldownSeconds ?? 60);
    const cooldownSeconds =
      Number.isFinite(cooldownSecRaw) && cooldownSecRaw >= 0 ? cooldownSecRaw : 60;

    const intentNormalized = payload.intent ? this.assertIntent(payload.intent) : "subscribe";
    const pending = await this.emailConfirmationsRepository.getActivePendingByRequest({
      email: to,
      intent: intentNormalized,
      aliasName: payload.aliasName,
      aliasDomain: payload.aliasDomain,
    });

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

    if (pending) {
      await this.emailConfirmationsRepository.rotateTokenForPending({
        pendingId: pending.id,
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

    const confirmBaseUrl = this.resolveConfirmBaseUrl({
      requestOrigin: payload.requestOrigin,
      requestReferer: payload.requestReferer,
    });
    const confirmUrl = this.buildConfirmUrl(
      token,
      confirmBaseUrl,
      payload.confirmEndpoint || forwardingSettings.confirmEndpoint,
    );

    const smtpSettings = this.configService.getOrThrow<SmtpSettings>("smtp");
    const from = String(smtpSettings.from || "").trim();
    if (!from) throw new Error("missing_SMTP_FROM");

    const tenantFqdn = this.extractHostname(confirmBaseUrl);

    const subjectTemplate = intentNormalized.startsWith("handle_")
      ? intentNormalized === "handle_unsubscribe"
        ? forwardingSettings.emailSubjectHandleUnsubscribe ||
          forwardingSettings.emailSubject ||
          "handle:delete"
        : forwardingSettings.emailSubjectHandleSubscribe ||
          forwardingSettings.emailSubject ||
          "handle:create"
      : intentNormalized === "unsubscribe"
        ? forwardingSettings.emailSubjectUnsubscribe || forwardingSettings.emailSubject
        : forwardingSettings.emailSubjectSubscribe ||
          forwardingSettings.emailSubject ||
          "Confirm your email";

    const subject = buildEmailSubject({
      template: subjectTemplate,
      host: tenantFqdn,
      code: token,
    });

    const displayName = payload.aliasDisplay ?? `${payload.aliasName}@${payload.aliasDomain}`;

    const actionLabel =
      intentNormalized === "unsubscribe" || intentNormalized === "handle_unsubscribe"
        ? "DEACTIVATE"
        : intentNormalized === "handle_domain_disable"
          ? "DISABLE DOMAIN"
          : intentNormalized === "handle_domain_enable"
            ? "ENABLE DOMAIN"
            : "CREATE";

    const actionSql =
      intentNormalized === "unsubscribe"
        ? `UPDATE alias SET goto='${PERMANENT_ALIAS_GOTO}', active=0, modified=CURRENT_TIMESTAMP() WHERE address='${payload.aliasName}@${payload.aliasDomain}' LIMIT 1;`
        : intentNormalized === "handle_subscribe"
          ? `INSERT INTO alias_handle (handle, address, active) VALUES ('${payload.aliasName}', '${to}', 1);`
          : intentNormalized === "handle_unsubscribe"
            ? `UPDATE alias_handle SET address=NULL, active=0, unsubscribed_at=CURRENT_TIMESTAMP() WHERE handle='${payload.aliasName}' LIMIT 1;`
            : intentNormalized === "handle_domain_disable"
              ? `INSERT INTO alias_handle_disabled_domain (handle_id, domain, active) VALUES (?, '${payload.aliasDomain}', 1) ON DUPLICATE KEY UPDATE active=1;`
              : intentNormalized === "handle_domain_enable"
                ? `UPDATE alias_handle_disabled_domain SET active=0 WHERE handle_id=? AND domain='${payload.aliasDomain}' LIMIT 1;`
                : `INSERT INTO alias (address, goto, active, created, modified) VALUES ('${payload.aliasName}@${payload.aliasDomain}', '${to}', 1, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP());`;

    const text = this.buildPlainText(
      token,
      ttlMinutes,
      actionLabel,
      actionSql,
      displayName,
      "",
      confirmUrl,
    );
    const html = this.buildHtml(tenantFqdn, token, ttlMinutes, actionSql, confirmUrl);

    const transporter = this.createTransport(smtpSettings);
    await transporter.sendMail({ from, to, subject, text, html });

    return { ok: true, sent: true, ttl_minutes: ttlMinutes };
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

  private resolveConfirmBaseUrl(headers: {
    requestOrigin?: string | undefined;
    requestReferer?: string | undefined;
  }): string {
    const fallback = this.getDefaultConfirmBaseUrl();

    for (const rawCandidate of [headers.requestOrigin, headers.requestReferer]) {
      const candidate = normalizeOriginInput(String(rawCandidate || ""));
      if (!candidate) {
        continue;
      }

      const allowedOrigin = this.originPolicy.resolveAllowedOrigin(candidate);
      if (allowedOrigin) {
        return allowedOrigin;
      }
    }

    return fallback;
  }

  private buildConfirmUrl(token: string, baseUrl: string, endpoint: string): string {
    const base =
      String(baseUrl || "").trim().replace(/\/+$/, "") || this.getDefaultConfirmBaseUrl();
    const ep = String(endpoint || "/console")
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
      `YOUR CONFIRMATION TOKEN IS: ${token}\n` +
      `EXPIRES IN ${ttlMinutes} MINUTES.\n\n` +
      `ALIAS MODIFICATION REQUEST DETECTED.\n` +
      `STATUS: PENDING CONFIRMATION.\n\n` +
      `ACTION\n` +
      `${actionLabel.toUpperCase()}\n\n` +
      `ALIAS\n` +
      `${aliasDomain ? `${aliasName}@${aliasDomain}` : aliasName}\n\n` +
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
    return renderSecurityEmail({
      tenantFqdn,
      preheader: `Token: ${token}. Expires in ${ttlMinutes} minutes.`,
      sectionLabel: "Security Verification",
      tokenLabel: "Confirmation Token",
      token,
      detailsHeading: "Action Details",
      details: [{ label: "Mutation", value: actionSql }],
      ttlMinutes,
      ttlPrefix: "This request expires in",
      paragraphs: [
        "Confirm the requested forwarding change only if you started it.",
        "Ignore this email if you did not request it. No token, no change.",
      ],
      cta: {
        href: confirmUrl,
        label: "Confirm Action ->",
      },
    });
  }
}
