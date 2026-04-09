import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer from "nodemailer";

import { AppLogger } from "../../../shared/logging/app-logger.service.js";
import { escapeHtml, extractHostFromUrl } from "./admin.utils.js";

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

interface AdminSettings {
  creationNotificationEnabled: boolean;
}

interface AppSettings {
  publicUrl: string;
}

@Injectable()
export class AdminCreationNotificationService {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLogger,
  ) {}

  notifyAliasCreated(payload: {
    aliasAddress: string;
    gotoEmail: string;
  }): void {
    const settings = this.configService.getOrThrow<AdminSettings>("admin");
    if (!settings.creationNotificationEnabled) return;

    const publicUrl = this.getPublicUrl();
    const unsubscribeUrl = `${publicUrl}/api/forward/unsubscribe?alias=${encodeURIComponent(payload.aliasAddress)}`;
    const sql = `INSERT INTO alias (address, goto, active) VALUES ('${payload.aliasAddress}', '${payload.gotoEmail}', 1);`;

    void this.send({
      to: payload.gotoEmail,
      resourceLabel: `alias <strong>${escapeHtml(payload.aliasAddress)}</strong>`,
      resourceType: "alias address",
      sql,
      unsubscribeUrl,
    }).catch((error) => {
      this.logger.error("admin.creation_notification.alias.error", {
        err: error,
        alias: payload.aliasAddress,
        goto: payload.gotoEmail,
      });
    });
  }

  notifyHandleCreated(payload: {
    handle: string;
    addressEmail: string;
  }): void {
    const settings = this.configService.getOrThrow<AdminSettings>("admin");
    if (!settings.creationNotificationEnabled) return;

    const publicUrl = this.getPublicUrl();
    const unsubscribeUrl = `${publicUrl}/api/handle/unsubscribe?handle=${encodeURIComponent(payload.handle)}`;
    const sql = `INSERT INTO alias_handle (handle, address, active) VALUES ('${payload.handle}', '${payload.addressEmail}', 1);`;

    void this.send({
      to: payload.addressEmail,
      resourceLabel: `handle <strong>${escapeHtml(payload.handle)}</strong>`,
      resourceType: "handle",
      sql,
      unsubscribeUrl,
    }).catch((error) => {
      this.logger.error("admin.creation_notification.handle.error", {
        err: error,
        handle: payload.handle,
        address: payload.addressEmail,
      });
    });
  }

  private async send(payload: {
    to: string;
    resourceLabel: string;
    resourceType: string;
    sql: string;
    unsubscribeUrl: string;
  }): Promise<void> {
    const smtpSettings = this.configService.getOrThrow<SmtpSettings>("smtp");
    const from = String(smtpSettings.from || "").trim();
    if (!from) throw new Error("missing_SMTP_FROM");

    const host = this.getHost();
    const localPart = payload.to.split("@")[0] || "there";

    const subject = `Admin action: ${payload.resourceType} created for you | ${host}`;

    const text =
      `Hello ${localPart},\n\n` +
      `This is a very rare informational email, sent only when necessary for transparency in the free mail forwarding service.\n\n` +
      `An administrator has manually created a new ${payload.resourceType} that points to your email.\n\n` +
      `Executed query:\n${payload.sql}\n\n` +
      `---\n\n` +
      `What this means:\n` +
      `Aliases are unique addresses that route email from our infrastructure to you.\n` +
      `Handles are like usernames. Claiming a handle reserves that username globally across all domains, and no one can register any alias with that username, regardless of the domain.\n\n` +
      `---\n\n` +
      `Disable this ${payload.resourceType}:\n` +
      `If you do not want to keep this ${payload.resourceType}, you can disable it using the link below.\n` +
      `${payload.unsubscribeUrl}\n\n` +
      `---\n\n` +
      `From Haltman.IO and The Hacker's Choice\n`;

    const html =
      `<p>Hello ${escapeHtml(localPart)},</p>` +
      `<p>This is a very rare informational email, sent only when necessary for transparency in the free mail forwarding service.</p>` +
      `<p>An administrator has manually created a new ${payload.resourceLabel} that points to your email.</p>` +
      `<p><strong>Executed query</strong><br><code>${escapeHtml(payload.sql)}</code></p>` +
      `<hr>` +
      `<p><strong>What this means</strong></p>` +
      `<p><strong>Aliases</strong> are unique addresses that route email from our infrastructure to you.</p>` +
      `<p><strong>Handles</strong> are like usernames. Claiming a handle reserves that username globally across all domains, and no one can register any alias with that username, regardless of the domain.</p>` +
      `<hr>` +
      `<p><strong>Why you received this</strong></p>` +
      `<p>You are receiving this email because you are one of the trusted users of this tool's administrators.</p>` +
      `<hr>` +
      `<p><strong>Disable this ${escapeHtml(payload.resourceType)}</strong></p>` +
      `<p>If you do not want to keep this ${escapeHtml(payload.resourceType)}, you can disable it normally using the link below.</p>` +
      `<p>You can call it with cURL from your terminal or simply open it in your browser:</p>` +
      `<p><a href="${escapeHtml(payload.unsubscribeUrl)}">${escapeHtml(payload.unsubscribeUrl)}</a></p>` +
      `<hr>` +
      `<p>From <strong>Haltman.IO</strong> and <strong>The Hacker's Choice</strong></p>`;

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

    await transporter.sendMail({ from, to: payload.to, subject, text, html });
  }

  private getPublicUrl(): string {
    const appSettings = this.configService.getOrThrow<AppSettings>("app");
    return String(appSettings.publicUrl || "").trim().replace(/\/+$/, "");
  }

  private getHost(): string {
    return extractHostFromUrl(this.getPublicUrl());
  }
}
