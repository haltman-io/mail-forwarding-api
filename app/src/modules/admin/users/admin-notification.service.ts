import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer from "nodemailer";

import { AppLogger } from "../../../shared/logging/app-logger.service.js";
import { renderSecurityEmail } from "../../../shared/utils/security-email-template.js";
import { extractHostFromUrl, formatAdminEmailSubject } from "../utils/admin.utils.js";

interface AdminSettings {
  userChangeEmailEnabled: boolean;
  userChangeEmailSubject: string;
}

interface AppSettings {
  publicUrl: string;
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

@Injectable()
export class AdminNotificationService {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLogger,
  ) {}

  notifyAffectedAdmins(payload: {
    recipientEmails: string[];
    targetEmail: string;
    actorEmail: string;
    action:
      | "admin_user_created"
      | "admin_user_updated"
      | "admin_user_deleted"
      | "admin_password_changed";
    changes: string[];
    requestIpText?: string;
    userAgent?: string;
    occurredAt?: Date;
  }): void {
    const adminSettings = this.configService.getOrThrow<AdminSettings>("admin");
    if (!adminSettings.userChangeEmailEnabled) {
      return;
    }

    const dedup = Array.from(
      new Set(
        (payload.recipientEmails || [])
          .map((value) => String(value || "").trim().toLowerCase())
          .filter(Boolean),
      ),
    );

    for (const email of dedup) {
      void this.sendNotification({
        toEmail: email,
        targetEmail: payload.targetEmail,
        actorEmail: payload.actorEmail,
        action: payload.action,
        changes: payload.changes,
        requestIpText: payload.requestIpText,
        userAgent: payload.userAgent,
        occurredAt: payload.occurredAt,
      }).catch((error) => {
        this.logger.error("admin.users.notify.error", {
          err: error,
          to_email: email,
          action: payload.action,
          target_email: payload.targetEmail,
        });
      });
    }
  }

  private async sendNotification(payload: {
    toEmail: string;
    targetEmail: string;
    actorEmail: string;
    action: string;
    changes: string[];
    requestIpText?: string | undefined;
    userAgent?: string | undefined;
    occurredAt?: Date | undefined;
  }): Promise<void> {
    const smtpSettings = this.configService.getOrThrow<SmtpSettings>("smtp");
    const from = String(smtpSettings.from || "").trim();
    if (!from) throw new Error("missing_SMTP_FROM");

    const adminSettings = this.configService.getOrThrow<AdminSettings>("admin");
    const appSettings = this.configService.getOrThrow<AppSettings>("app");
    const host = extractHostFromUrl(appSettings.publicUrl);
    const when = payload.occurredAt ? new Date(payload.occurredAt) : new Date();
    const occurredAtIso = Number.isNaN(when.getTime()) ? new Date().toISOString() : when.toISOString();
    const occurredAtUtc = new Date(occurredAtIso).toUTCString();
    const requestIp = String(payload.requestIpText || "").trim() || "unknown";
    const userAgent = String(payload.userAgent || "").trim() || "unknown";
    const changeSummary = payload.changes.length > 0 ? payload.changes.join(", ") : "metadata";

    const subject =
      payload.action === "admin_user_created" && payload.toEmail === payload.targetEmail
        ? formatAdminEmailSubject({
            template: "Welcome: admin account created | {host}",
            host,
            action: payload.action,
            targetEmail: payload.targetEmail,
            actorEmail: payload.actorEmail,
            occurredAtIso,
            fallback: "Welcome: admin account created | {host}",
          })
        : formatAdminEmailSubject({
            template: adminSettings.userChangeEmailSubject,
            host,
            action: payload.action,
            targetEmail: payload.targetEmail,
            actorEmail: payload.actorEmail,
            occurredAtIso,
            fallback: "Security alert: admin account changed | {host}",
          });

    const transporter = nodemailer.createTransport({
      host: smtpSettings.host,
      port: smtpSettings.port,
      secure: smtpSettings.secure,
      auth: smtpSettings.authEnabled
        ? { user: String(smtpSettings.user || ""), pass: String(smtpSettings.pass || "") }
        : undefined,
      name: smtpSettings.heloName || undefined,
      tls: {
        rejectUnauthorized: smtpSettings.tlsRejectUnauthorized,
      },
    });

    if (payload.action === "admin_user_created" && payload.toEmail === payload.targetEmail) {
      await transporter.sendMail({
        from,
        to: payload.toEmail,
        subject,
        text:
          `WELCOME TO THE ADMIN PANEL.\n\n` +
          `A new administrator account has been created for you.\n\n` +
          `NEW ADMIN: ${payload.targetEmail}\n` +
          `CREATED BY ADMIN: ${payload.actorEmail}\n` +
          `DATE/TIME (ISO 8601): ${occurredAtIso}\n` +
          `DATE/TIME (UTC): ${occurredAtUtc}\n\n` +
          `Your credential will be delivered securely through another channel.\n` +
          `For security reasons, credentials are never sent by email.\n`,
        html: renderSecurityEmail({
          tenantFqdn: host,
          preheader: `Admin account created for ${payload.targetEmail}.`,
          sectionLabel: "Admin Access",
          detailsHeading: "Event Details",
          details: [
            { label: "New Admin", value: payload.targetEmail },
            { label: "Created By Admin", value: payload.actorEmail },
            { label: "Date/Time (ISO 8601)", value: occurredAtIso },
            { label: "Date/Time (UTC)", value: occurredAtUtc },
          ],
          paragraphs: [
            "A new administrator account has been created for you.",
            "Your credential will be delivered securely through another channel.",
            "For security reasons, credentials are never sent by email.",
          ],
        }),
      });
      return;
    }

    await transporter.sendMail({
      from,
      to: payload.toEmail,
      subject,
      text:
        `ADMIN ACCOUNT CHANGE DETECTED.\n\n` +
        `ACTION: ${payload.action}\n` +
        `TARGET ADMIN: ${payload.targetEmail}\n` +
        `ACTOR ADMIN: ${payload.actorEmail}\n` +
        `CHANGES: ${changeSummary}\n` +
        `DATE/TIME (ISO 8601): ${occurredAtIso}\n` +
        `DATE/TIME (UTC): ${occurredAtUtc}\n` +
        `SOURCE IP: ${requestIp}\n` +
        `USER AGENT: ${userAgent}\n`,
      html: renderSecurityEmail({
        tenantFqdn: host,
        preheader: `Admin account change detected for ${payload.targetEmail}.`,
        sectionLabel: "Admin Security Alert",
        detailsHeading: "Event Details",
        details: [
          { label: "Action", value: payload.action },
          { label: "Target Admin", value: payload.targetEmail },
          { label: "Actor Admin", value: payload.actorEmail },
          { label: "Changes", value: changeSummary },
          { label: "Date/Time (ISO 8601)", value: occurredAtIso },
          { label: "Date/Time (UTC)", value: occurredAtUtc },
          { label: "Source IP", value: requestIp },
          { label: "User Agent", value: userAgent },
        ],
        paragraphs: ["Review this event if you were not expecting changes to admin access."],
      }),
    });
  }
}
