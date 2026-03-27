import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer from "nodemailer";

import { buildEmailSubject } from "../../../shared/utils/email-subject-template.js";
import { packIp16 } from "../../../shared/utils/ip-pack.js";
import { renderSecurityEmail } from "../../../shared/utils/security-email-template.js";
import {
  PasswordResetRequestsRepository,
  type PendingMeta,
} from "../repositories/password-reset-requests.repository.js";

interface AppSettings {
  publicUrl: string;
}

interface AuthSettings {
  passwordResetTtlMinutes: number;
  passwordResetResendCooldownSeconds: number;
  passwordResetMaxSends: number;
  passwordResetEmailSubject: string;
}

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

export interface SendPasswordResetResult {
  ok: boolean;
  sent: boolean;
  reason?: string;
  ttl_minutes: number;
  pending: PendingMeta | null;
  action?: string;
}

@Injectable()
export class PasswordResetEmailService {
  constructor(
    private readonly configService: ConfigService,
    private readonly passwordResetRequestsRepository: PasswordResetRequestsRepository,
  ) {}

  async sendPasswordResetEmail(payload: {
    userId: number;
    email: string;
    requestIpText?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<SendPasswordResetResult> {
    const normalizedUserId = Number(payload.userId);
    if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
      throw new Error("invalid_user_id");
    }

    const to = this.normalizeEmailStrict(payload.email);
    if (!to) throw new Error("invalid_email");

    const authSettings = this.configService.getOrThrow<AuthSettings>("auth");
    const ttlMinutes = this.sanitizePositiveInt(authSettings.passwordResetTtlMinutes, 15);
    const cooldownSeconds = this.sanitizeNonNegativeInt(
      authSettings.passwordResetResendCooldownSeconds,
      60,
    );
    const maxSendCount = this.sanitizePositiveInt(authSettings.passwordResetMaxSends, 3);
    const requestIpPacked = payload.requestIpText ? packIp16(payload.requestIpText) : null;
    const ua = String(payload.userAgent || "").slice(0, 255);

    const result = await this.passwordResetRequestsRepository.upsertPendingByUserIdTx({
      userId: normalizedUserId,
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

    if (!("token_plain" in result)) {
      throw new Error("missing_token_plain");
    }

    const token = result.token_plain;
    if (!token) throw new Error("missing_token_plain");

    const smtpSettings = this.configService.getOrThrow<SmtpSettings>("smtp");
    const from = String(smtpSettings.from || "").trim();
    if (!from) throw new Error("missing_SMTP_FROM");

    const host = this.getDefaultHost();
    const subject = buildEmailSubject({
      template: authSettings.passwordResetEmailSubject || "Password reset",
      host,
      code: token,
    });

    const resetEndpoint = "POST /api/auth/reset-password";
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

    const html = renderSecurityEmail({
      tenantFqdn: host,
      preheader: `Token: ${token}. Expires in ${ttlMinutes} minutes.`,
      sectionLabel: "Password Reset",
      tokenLabel: "Verification Code",
      token,
      detailsHeading: "Action Details",
      details: [{ label: "Reset Endpoint", value: resetEndpoint }],
      ttlMinutes,
      ttlPrefix: "This code expires in",
      paragraphs: [
        "Use this code to set a new password.",
        "This token is single-use and will be discarded after a successful password change.",
        "Ignore this email if you did not request it.",
      ],
    });

    const transporter = this.createTransport(smtpSettings);
    await transporter.sendMail({ from, to, subject, text, html });

    return {
      ok: true,
      sent: true,
      ttl_minutes: ttlMinutes,
      pending: result.pending || null,
      action: result.action || "created",
    };
  }

  private normalizeEmailStrict(email: unknown): string {
    if (typeof email !== "string") return "";
    return email.trim().toLowerCase();
  }

  private sanitizePositiveInt(value: unknown, fallback: number): number {
    const raw = Number(value);
    if (!Number.isFinite(raw) || raw <= 0) return fallback;
    return Math.floor(raw);
  }

  private sanitizeNonNegativeInt(value: unknown, fallback: number): number {
    const raw = Number(value);
    if (!Number.isFinite(raw) || raw < 0) return fallback;
    return Math.floor(raw);
  }

  private getDefaultHost(): string {
    const appSettings = this.configService.getOrThrow<AppSettings>("app");
    const base = String(appSettings.publicUrl || "").trim();
    if (!base) return "localhost";
    try {
      return new URL(base).hostname || "localhost";
    } catch {
      return base.replace(/^https?:\/\//i, "").replace(/\/.*$/, "") || "localhost";
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
}
