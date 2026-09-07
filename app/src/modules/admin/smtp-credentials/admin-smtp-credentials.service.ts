import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PoolConnection } from "mariadb";

import { isDuplicateEntry } from "../../../shared/database/database.utils.js";
import { DatabaseService } from "../../../shared/database/database.service.js";
import { PublicHttpException } from "../../../shared/errors/public-http.exception.js";
import {
  createOpaqueToken,
  isOpaqueTokenFormatValid,
  normalizeOpaqueToken,
} from "../../../shared/utils/auth-secrets.js";
import { sha256Buffer } from "../../../shared/utils/crypto.js";
import {
  parseMailbox,
  type ParsedMailbox,
} from "../../../shared/validation/mailbox.js";
import type { ResolvedAuthContext } from "../../auth/services/auth-session-context.service.js";
import { PasswordService } from "../../auth/services/password.service.js";
import { AdminAliasesRepository } from "../aliases/admin-aliases.repository.js";
import { AdminDomainsRepository } from "../domains/admin-domains.repository.js";
import { AdminHandlesRepository } from "../handles/admin-handles.repository.js";
import type {
  AdminCreateSmtpCredentialDto,
  AdminCreateSmtpInviteDto,
  AdminSmtpCredentialsListQueryDto,
  AdminUpdateSmtpCredentialDto,
  SmtpSetupClaimDto,
} from "../dto/admin.dto.js";
import { withTxRetry } from "../utils/admin-database.utils.js";
import { AdminSmtpCredentialsRepository } from "./admin-smtp-credentials.repository.js";
import type {
  AdminSmtpCredentialRow,
  AdminSmtpUserRow,
  SmtpInviteTokenRow,
} from "./admin-smtp-credentials.repository.js";

interface AppSettings {
  publicUrl: string;
}

interface SmtpSettings {
  host: string;
  submissionHost: string;
  submissionPort: number;
  submissionSecure: boolean;
}

export interface PublicSmtpCredential {
  id: number;
  username: string;
  active: number;
  created_at: Date | string | null;
  allowed_senders: string[];
}

export interface SmtpConnectionParams {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  sender: string;
}

const DEFAULT_INVITE_TTL_HOURS = 72;
const MAX_ALLOWED_SENDERS = 100;

@Injectable()
export class AdminSmtpCredentialsService {
  constructor(
    private readonly configService: ConfigService,
    private readonly database: DatabaseService,
    private readonly smtpCredentialsRepository: AdminSmtpCredentialsRepository,
    private readonly passwordService: PasswordService,
    private readonly adminAliasesRepository: AdminAliasesRepository,
    private readonly adminDomainsRepository: AdminDomainsRepository,
    private readonly adminHandlesRepository: AdminHandlesRepository,
  ) {}

  async listCredentials(query: AdminSmtpCredentialsListQueryDto): Promise<{
    items: PublicSmtpCredential[];
    pagination: { total: number; limit: number; offset: number };
  }> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const [rows, total] = await Promise.all([
      this.smtpCredentialsRepository.listCredentials({
        limit,
        offset,
        active: query.active,
        username: query.username,
        sender: query.sender,
      }),
      this.smtpCredentialsRepository.countCredentials({
        active: query.active,
        username: query.username,
        sender: query.sender,
      }),
    ]);

    return {
      items: rows.map((row) => this.toPublicCredential(row)),
      pagination: { total, limit, offset },
    };
  }

  async createCredential(dto: AdminCreateSmtpCredentialDto): Promise<{
    ok: true;
    created: true;
    generated_password: boolean;
    password?: string;
    item: PublicSmtpCredential;
  }> {
    const login = this.normalizeLogin(dto.username);
    const username = login.email;
    const allowedSenders = this.normalizeSenderList(dto.allowed_senders, {
      allowEmpty: false,
    });
    const active = dto.active === undefined ? true : this.normalizeActive(dto.active);
    const plainPassword = dto.password ?? this.generatePassword();
    const passwordHash = await this.hashSmtpPassword(plainPassword);

    try {
      const item = await withTxRetry(this.database, async (connection) => {
        const existing = await this.smtpCredentialsRepository.getUserByUsername(
          username,
          connection,
          { forUpdate: true },
        );
        if (existing) {
          throw new PublicHttpException(409, { error: "smtp_username_taken", username });
        }

        await this.assertResolvableHostedLogin(login, connection);
        await this.assertSupportedSenders(allowedSenders, connection);
        await this.smtpCredentialsRepository.createUser(
          { username, passwordHash, active },
          connection,
        );
        await this.smtpCredentialsRepository.replaceAllowedSenders(
          username,
          allowedSenders.map((sender) => sender.email),
          connection,
        );

        return this.getCredentialOrThrow(username, connection);
      });

      return {
        ok: true,
        created: true,
        generated_password: dto.password === undefined,
        ...(dto.password === undefined ? { password: plainPassword } : {}),
        item,
      };
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw new PublicHttpException(409, { error: "smtp_username_taken", username });
      }
      throw error;
    }
  }

  async updateCredential(
    rawUsername: string,
    dto: AdminUpdateSmtpCredentialDto,
  ): Promise<{ ok: true; updated: true; item: PublicSmtpCredential }> {
    const username = this.normalizeLogin(rawUsername).email;
    const hasPassword = dto.password !== undefined;
    const hasAllowedSenders = dto.allowed_senders !== undefined;
    const hasActive = dto.active !== undefined;

    if (!hasPassword && !hasAllowedSenders && !hasActive) {
      throw new PublicHttpException(400, { error: "empty_patch" });
    }

    const passwordHash = hasPassword ? await this.hashSmtpPassword(dto.password) : undefined;
    const allowedSenders = hasAllowedSenders
      ? this.normalizeSenderList(dto.allowed_senders, { allowEmpty: true })
      : undefined;
    const active = hasActive ? this.normalizeActive(dto.active) : undefined;

    const item = await withTxRetry(this.database, async (connection) => {
      const existing = await this.smtpCredentialsRepository.getUserByUsername(
        username,
        connection,
        { forUpdate: true },
      );
      if (!existing) {
        throw new PublicHttpException(404, { error: "smtp_credential_not_found", username });
      }

      if (allowedSenders !== undefined) {
        await this.assertSupportedSenders(allowedSenders, connection);
      }

      await this.smtpCredentialsRepository.updateUser(
        username,
        { passwordHash, active },
        connection,
      );

      if (allowedSenders !== undefined) {
        await this.smtpCredentialsRepository.replaceAllowedSenders(
          username,
          allowedSenders.map((sender) => sender.email),
          connection,
        );
      }

      return this.getCredentialOrThrow(username, connection);
    });

    return { ok: true, updated: true, item };
  }

  async deleteCredential(
    rawUsername: string,
  ): Promise<{ ok: true; deleted: true; item: PublicSmtpCredential }> {
    const username = this.normalizeLogin(rawUsername).email;

    const item = await withTxRetry(this.database, async (connection) => {
      const existing = await this.smtpCredentialsRepository.getUserByUsername(
        username,
        connection,
        { forUpdate: true },
      );
      if (!existing) {
        throw new PublicHttpException(404, { error: "smtp_credential_not_found", username });
      }

      const current = await this.getCredentialOrThrow(username, connection);
      await this.smtpCredentialsRepository.deleteAclByLogin(username, connection);
      await this.smtpCredentialsRepository.deleteUser(username, connection);
      return current;
    });

    return { ok: true, deleted: true, item };
  }

  async createInvite(
    dto: AdminCreateSmtpInviteDto,
    authContext: ResolvedAuthContext,
  ): Promise<{
    ok: true;
    created: true;
    setup_url: string;
    allowed_sender_constraint: string | null;
    expires_at: Date | string;
  }> {
    const allowedSenderConstraint = dto.allowed_sender_constraint
      ? this.normalizeSender(dto.allowed_sender_constraint, "allowed_sender_constraint")
      : null;
    if (allowedSenderConstraint) {
      await this.assertSupportedSender(
        allowedSenderConstraint,
        undefined,
        "allowed_sender_constraint",
      );
    }

    const ttlHours = this.normalizeInviteTtlHours(dto.expires_in_hours);
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60_000);
    const token = createOpaqueToken();
    const invite = await this.smtpCredentialsRepository.createInvite({
      tokenHash: sha256Buffer(token),
      createdBy: this.formatInviteActor(authContext),
      allowedSenderConstraint: allowedSenderConstraint?.email ?? null,
      expiresAt,
    });

    return {
      ok: true,
      created: true,
      setup_url: this.buildSetupUrl(token),
      allowed_sender_constraint: invite.allowed_sender_constraint,
      expires_at: invite.expires_at,
    };
  }

  async getSetup(token: string): Promise<{
    ok: true;
    valid: true;
    allowed_sender_constraint: string | null;
    expires_at: Date | string;
  }> {
    const invite = await this.getPendingInvite(token);
    return {
      ok: true,
      valid: true,
      allowed_sender_constraint: invite.allowed_sender_constraint,
      expires_at: invite.expires_at,
    };
  }

  async claimSetup(
    token: string,
    dto: SmtpSetupClaimDto,
  ): Promise<{ ok: true; claimed: true; smtp: SmtpConnectionParams }> {
    const tokenHash = this.normalizeTokenHash(token);
    const sender = this.normalizeSender(dto.sender ?? dto.alias, "sender");
    const login = this.normalizeLogin(dto.username);
    const username = login.email;
    const password = this.normalizePlainPassword(dto.password);
    const passwordHash = await this.hashSmtpPassword(password);

    try {
      await withTxRetry(this.database, async (connection) => {
        const invite = await this.smtpCredentialsRepository.getPendingInviteByTokenHash(
          tokenHash,
          connection,
          { forUpdate: true },
        );
        if (!invite) {
          throw new PublicHttpException(400, { error: "invalid_or_expired_token" });
        }

        if (
          invite.allowed_sender_constraint &&
          invite.allowed_sender_constraint !== sender.email
        ) {
          throw new PublicHttpException(403, {
            error: "sender_not_allowed",
            allowed_sender_constraint: invite.allowed_sender_constraint,
          });
        }

        await this.assertResolvableHostedLogin(login, connection);
        await this.assertSupportedSender(sender, connection, "sender");
        const existing = await this.smtpCredentialsRepository.getUserByUsername(
          username,
          connection,
          { forUpdate: true },
        );
        if (existing) {
          throw new PublicHttpException(409, { error: "smtp_username_taken", username });
        }

        await this.smtpCredentialsRepository.createUser(
          { username, passwordHash, active: true },
          connection,
        );
        await this.smtpCredentialsRepository.replaceAllowedSenders(
          username,
          [sender.email],
          connection,
        );

        const marked = await this.smtpCredentialsRepository.markInviteUsed(
          invite.id,
          username,
          connection,
        );
        if (!marked) {
          throw new PublicHttpException(400, { error: "invalid_or_expired_token" });
        }
      });
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw new PublicHttpException(409, { error: "smtp_username_taken", username });
      }
      throw error;
    }

    return {
      ok: true,
      claimed: true,
      smtp: {
        ...this.getSubmissionEndpoint(),
        username,
        password,
        sender: sender.email,
      },
    };
  }

  private async getCredentialOrThrow(
    username: string,
    connection?: PoolConnection,
  ): Promise<PublicSmtpCredential> {
    const row = await this.smtpCredentialsRepository.getUserByUsername(username, connection);
    if (!row) {
      throw new PublicHttpException(404, { error: "smtp_credential_not_found", username });
    }
    const senders = await this.smtpCredentialsRepository.listActiveSendersForLogins(
      [username],
      connection,
    );
    return this.toPublicCredential({
      ...row,
      allowed_senders: senders.get(username) ?? [],
    });
  }

  private async getPendingInvite(token: string): Promise<SmtpInviteTokenRow> {
    const row = await this.smtpCredentialsRepository.getPendingInviteByTokenHash(
      this.normalizeTokenHash(token),
    );
    if (!row) {
      throw new PublicHttpException(400, { error: "invalid_or_expired_token" });
    }
    return row;
  }

  private async assertResolvableHostedLogin(
    login: ParsedMailbox,
    connection?: PoolConnection,
  ): Promise<void> {
    await this.assertSupportedDomain(login.domain, connection, "username", login.email);

    const alias = await this.adminAliasesRepository.getByAddress(
      login.email,
      connection,
      { forUpdate: Boolean(connection) },
    );
    if (alias && Number(alias.active || 0) === 1 && alias.domain_id) {
      return;
    }

    const handle = await this.adminHandlesRepository.getByHandle(
      login.local,
      connection,
      { forUpdate: Boolean(connection) },
    );
    if (handle && Number(handle.active || 0) === 1 && String(handle.address || "").trim()) {
      return;
    }

    throw new PublicHttpException(404, {
      error: "smtp_username_not_resolvable",
      username: login.email,
    });
  }

  private async assertSupportedSenders(
    senders: ParsedMailbox[],
    connection?: PoolConnection,
  ): Promise<void> {
    for (const sender of senders) {
      await this.assertSupportedSender(sender, connection, "allowed_senders");
    }
  }

  private async assertSupportedSender(
    sender: ParsedMailbox,
    connection?: PoolConnection,
    field = "allowed_senders",
  ): Promise<void> {
    await this.assertSupportedDomain(sender.domain, connection, field, sender.email);
  }

  private async assertSupportedDomain(
    domainName: string,
    connection: PoolConnection | undefined,
    field: string,
    email: string,
  ): Promise<void> {
    const domain = connection
      ? await this.adminDomainsRepository.getByName(domainName, connection, {
          forUpdate: true,
        })
      : await this.adminDomainsRepository.getEmailValidByName(domainName);

    if (!domain || Number(domain.active || 0) !== 1 || Number(domain.active_mx || 0) !== 1) {
      throw new PublicHttpException(400, {
        error: field === "username" ? "invalid_username_domain" : "invalid_sender_domain",
        field,
        email,
      });
    }
  }

  private normalizeSenderList(
    raw: unknown,
    options: { allowEmpty: boolean },
  ): ParsedMailbox[] {
    if (!Array.isArray(raw)) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "allowed_senders" });
    }
    if (!options.allowEmpty && raw.length === 0) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "allowed_senders" });
    }
    if (raw.length > MAX_ALLOWED_SENDERS) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "allowed_senders" });
    }

    const deduped = new Map<string, ParsedMailbox>();
    for (const item of raw) {
      const sender = this.normalizeSender(item, "allowed_senders");
      deduped.set(sender.email, sender);
    }

    if (!options.allowEmpty && deduped.size === 0) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "allowed_senders" });
    }
    return [...deduped.values()];
  }

  private normalizeSender(raw: unknown, field: string): ParsedMailbox {
    const sender = parseMailbox(raw);
    if (!sender) {
      throw new PublicHttpException(400, { error: "invalid_params", field });
    }
    return sender;
  }

  private normalizeLogin(raw: unknown): ParsedMailbox {
    const login = parseMailbox(raw);
    if (!login) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "username" });
    }
    return login;
  }

  private normalizeActive(raw: unknown): boolean {
    if (typeof raw !== "boolean") {
      throw new PublicHttpException(400, { error: "invalid_params", field: "active" });
    }
    return raw;
  }

  private normalizeInviteTtlHours(raw: unknown): number {
    if (raw === undefined) return DEFAULT_INVITE_TTL_HOURS;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 720) {
      throw new PublicHttpException(400, {
        error: "invalid_params",
        field: "expires_in_hours",
      });
    }
    return value;
  }

  private normalizeTokenHash(raw: unknown): Buffer {
    const token = normalizeOpaqueToken(raw);
    if (!isOpaqueTokenFormatValid(token)) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "token" });
    }
    return sha256Buffer(token);
  }

  private async hashSmtpPassword(plainPassword: unknown): Promise<string> {
    try {
      const hash = await this.passwordService.hashPassword(
        this.normalizePlainPassword(plainPassword),
      );
      return this.formatDovecotPasswordHash(hash);
    } catch (error) {
      if (error instanceof PublicHttpException) throw error;
      if (error instanceof Error && error.message === "invalid_password") {
        throw new PublicHttpException(400, { error: "invalid_params", field: "password" });
      }
      throw error;
    }
  }

  private normalizePlainPassword(raw: unknown): string {
    try {
      return this.passwordService.assertPlainPassword(raw);
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_password") {
        throw new PublicHttpException(400, { error: "invalid_params", field: "password" });
      }
      throw error;
    }
  }

  private formatDovecotPasswordHash(hash: string): string {
    const value = String(hash || "").trim();
    if (/^\{[A-Z0-9_-]+\}/.test(value)) return value;
    if (value.startsWith("$argon2id$")) return `{ARGON2ID}${value}`;
    throw new Error("unexpected_smtp_password_hash");
  }

  private generatePassword(): string {
    return createOpaqueToken(24);
  }

  private buildSetupUrl(token: string): string {
    const appSettings = this.configService.getOrThrow<AppSettings>("app");
    const base = String(appSettings.publicUrl || "").trim().replace(/\/+$/, "");
    if (!base) {
      throw new PublicHttpException(500, { error: "missing_APP_PUBLIC_URL" });
    }
    return `${base}/api/smtp-setup/${encodeURIComponent(token)}`;
  }

  private getSubmissionEndpoint(): Omit<SmtpConnectionParams, "username" | "password" | "sender"> {
    const smtpSettings = this.configService.getOrThrow<SmtpSettings>("smtp");
    const appSettings = this.configService.getOrThrow<AppSettings>("app");
    const host =
      String(smtpSettings.submissionHost || "").trim() ||
      this.extractHostname(appSettings.publicUrl) ||
      String(smtpSettings.host || "").trim();

    if (!host) {
      throw new PublicHttpException(500, { error: "missing_SMTP_SUBMISSION_HOST" });
    }

    const port = Number.isInteger(Number(smtpSettings.submissionPort))
      ? Number(smtpSettings.submissionPort)
      : 587;

    return {
      host,
      port,
      secure: Boolean(smtpSettings.submissionSecure),
    };
  }

  private extractHostname(raw: unknown): string {
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) return "";
    try {
      return new URL(value).hostname;
    } catch {
      return value.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
    }
  }

  private formatInviteActor(authContext: ResolvedAuthContext): string {
    return (
      String(authContext.email || "").trim().toLowerCase() ||
      String(authContext.username || "").trim().toLowerCase() ||
      String(authContext.user_id || "")
    );
  }

  private toPublicCredential(
    row: AdminSmtpCredentialRow | (AdminSmtpUserRow & { allowed_senders: string[] }),
  ): PublicSmtpCredential {
    return {
      id: Number(row.id),
      username: row.username,
      active: Number(row.active || 0),
      created_at: row.created_at || null,
      allowed_senders: row.allowed_senders,
    };
  }
}
