import crypto from "node:crypto";
import { Injectable } from "@nestjs/common";

import { PublicHttpException } from "../../../shared/errors/public-http.exception.js";
import { AppLogger } from "../../../shared/logging/app-logger.service.js";
import { normalizeEmailStrict } from "../../../shared/utils/auth-identifiers.js";
import { sha256Buffer } from "../../../shared/utils/crypto.js";
import { packIp16 } from "../../../shared/utils/ip-pack.js";
import {
  isConfirmationCodeValid,
  normalizeConfirmationCode,
} from "../../../shared/utils/confirmation-code.js";
import { parseMailbox } from "../../../shared/validation/mailbox.js";
import { DatabaseService } from "../../../shared/database/database.service.js";
import { BanPolicyService } from "../../bans/ban-policy.service.js";
import { DomainRepository } from "../../domains/domain.repository.js";
import {
  ApiTokensRepository,
  type ApiTokenPublicMetadata,
  type ApiTokenRow,
} from "../repositories/api-tokens.repository.js";
import {
  ApiTokenRequestsRepository,
  type ApiTokenRequestAction,
} from "../repositories/api-token-requests.repository.js";
import { ApiCredentialsEmailService } from "./api-credentials-email.service.js";

const RE_API_KEY = /^[a-z0-9]{64}$/;

type ConfirmResult = {
  status: number;
  body: Record<string, unknown>;
  isSuccess: boolean;
  successPayload?: { email: string; token: string; expiresInDays: number };
};

@Injectable()
export class ApiCredentialsService {
  constructor(
    private readonly apiCredentialsEmailService: ApiCredentialsEmailService,
    private readonly apiTokenRequestsRepository: ApiTokenRequestsRepository,
    private readonly apiTokensRepository: ApiTokensRepository,
    private readonly banPolicyService: BanPolicyService,
    private readonly databaseService: DatabaseService,
    private readonly logger: AppLogger,
    private readonly domainRepository: DomainRepository,
  ) {}

  async createCredentials(params: {
    email: unknown;
    days: unknown;
    automaticRenew: unknown;
    ip: string | undefined;
    userAgent: string;
  }): Promise<Record<string, unknown>> {
    const email = normalizeEmailStrict(params.email);
    if (!email) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "email" });
    }

    const days = this.parseDays(params.days, 9999);
    if (!days) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "days", hint: "integer 1..9999" });
    }

    const automaticRenew = this.parseOptionalBoolean(params.automaticRenew, false);
    if (automaticRenew === null) {
      throw new PublicHttpException(400, {
        error: "invalid_params",
        field: "automatic_renew",
        hint: "boolean",
      });
    }
    const automaticRenewEnabled = Boolean(automaticRenew);

    await this.assertRequestAllowedForEmail(email, params.ip);
    await this.assertOwnerEmailIsNotManagedDomain(email);

    const result = await this.apiCredentialsEmailService.sendApiTokenRequestEmail({
      email,
      action: "create",
      days,
      automaticRenew: automaticRenewEnabled,
      requestIpText: params.ip,
      userAgent: params.userAgent,
    });

    return {
      ok: true,
      action: "api_credentials_create",
      email,
      days,
      automatic_renew: automaticRenewEnabled,
      confirmation: this.toConfirmationBody(result),
    };
  }

  async requestApiKeyList(params: {
    email: unknown;
    ip: string | undefined;
    userAgent: string;
  }): Promise<Record<string, unknown>> {
    return this.requestVerifiedEmailAction({
      action: "list",
      responseAction: "api_credentials_list_request",
      emailRaw: params.email,
      ip: params.ip,
      userAgent: params.userAgent,
    });
  }

  async requestDestroyAllApiKeys(params: {
    email: unknown;
    ip: string | undefined;
    userAgent: string;
  }): Promise<Record<string, unknown>> {
    return this.requestVerifiedEmailAction({
      action: "destroy_all",
      responseAction: "api_credentials_destroy_all_request",
      emailRaw: params.email,
      ip: params.ip,
      userAgent: params.userAgent,
    });
  }

  async renewApiKey(params: {
    apiKeyRaw: unknown;
    days: unknown;
    ip: string | undefined;
  }): Promise<Record<string, unknown>> {
    const apiKey = this.normalizeApiKey(params.apiKeyRaw);
    const days = this.parseDays(params.days, 999);
    if (!apiKey) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "api_key" });
    }
    if (!days) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "days", hint: "integer 1..999" });
    }

    const tokenRow = await this.getUsableTokenByPlaintext(apiKey, params.ip);
    await this.assertOwnerEmailIsNotManagedDomain(tokenRow.owner_email);
    const renewed = await this.apiTokensRepository.renewActiveById(tokenRow.id, days);
    if (!renewed) {
      throw new PublicHttpException(401, { error: "invalid_or_expired_api_key" });
    }

    return {
      ok: true,
      action: "api_credentials_renew",
      renewed: true,
      days_added: days,
      item: await this.getActiveMetadataOrEmpty(tokenRow.id),
    };
  }

  async setAutomaticRenew(params: {
    apiKeyRaw: unknown;
    automaticRenew: unknown;
    ip: string | undefined;
  }): Promise<Record<string, unknown>> {
    const apiKey = this.normalizeApiKey(params.apiKeyRaw);
    const automaticRenew = this.parseOptionalBoolean(params.automaticRenew, undefined);
    if (!apiKey) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "api_key" });
    }
    if (automaticRenew === null || automaticRenew === undefined) {
      throw new PublicHttpException(400, {
        error: "invalid_params",
        field: "automatic_renew",
        hint: "boolean",
      });
    }

    const tokenRow = await this.getUsableTokenByPlaintext(apiKey, params.ip);
    await this.assertOwnerEmailIsNotManagedDomain(tokenRow.owner_email);
    const updated = await this.apiTokensRepository.setAutomaticRenewById(tokenRow.id, automaticRenew);
    if (!updated) {
      throw new PublicHttpException(401, { error: "invalid_or_expired_api_key" });
    }

    return {
      ok: true,
      action: "api_credentials_automatic_renew",
      updated: true,
      automatic_renew: automaticRenew,
      item: await this.getActiveMetadataOrEmpty(tokenRow.id),
    };
  }

  async destroyApiKey(params: {
    apiKeyRaw: unknown;
    ip: string | undefined;
    userAgent: string;
  }): Promise<Record<string, unknown>> {
    const apiKey = this.normalizeApiKey(params.apiKeyRaw);
    if (!apiKey) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "api_key" });
    }

    const tokenRow = await this.getUsableTokenByPlaintext(apiKey, params.ip);
    const deleted = await this.apiTokensRepository.deleteActiveById(tokenRow.id);
    if (!deleted) {
      throw new PublicHttpException(401, { error: "invalid_or_expired_api_key" });
    }

    let notificationSent = true;
    try {
      await this.apiCredentialsEmailService.sendApiTokenDestroyedEmail({
        email: tokenRow.owner_email,
        requestIpText: params.ip,
        userAgent: params.userAgent,
      });
    } catch (error) {
      notificationSent = false;
      this.logger.logError("api_credentials_destroy_notification_failed", error, undefined, {
        owner_email: tokenRow.owner_email,
      });
    }

    return {
      ok: true,
      action: "api_credentials_destroy",
      destroyed: true,
      notification_sent: notificationSent,
    };
  }

  async previewConfirmation(tokenRaw: unknown): Promise<{
    previewBody: Record<string, unknown>;
    token: string;
  }> {
    const token = this.parseConfirmationToken(tokenRaw);
    const tokenHash32 = sha256Buffer(token);
    const pending = await this.apiTokenRequestsRepository.getPendingByTokenHash(tokenHash32);
    if (!pending) {
      throw new PublicHttpException(400, { error: "invalid_or_expired" });
    }

    return {
      previewBody: {
        ok: true,
        pending: true,
        mutation_required: true,
        action: pending.action || "create",
        email: String(pending.email || "").trim().toLowerCase(),
        days: Number(pending.days || 0),
        automatic_renew: Number(pending.automatic_renew ?? 0) === 1,
      },
      token,
    };
  }

  async confirmCredentials(params: {
    tokenRaw: unknown;
    ip: string | undefined;
    userAgent: string;
  }): Promise<ConfirmResult> {
    const token = this.parseConfirmationToken(params.tokenRaw);
    const tokenHash32 = sha256Buffer(token);

    const result = await this.databaseService.withTransaction(async (connection) => {
      const pending = await this.apiTokenRequestsRepository.getPendingByTokenHash(
        tokenHash32,
        connection,
        { forUpdate: true },
      );

      if (!pending) {
        return {
          status: 400,
          body: { error: "invalid_or_expired" },
          isSuccess: false,
        } as const;
      }

      const action = pending.action || "create";
      const ownerEmail = String(pending.email).trim().toLowerCase();
      await this.assertRequestAllowedForEmail(ownerEmail, params.ip);
      await this.assertOwnerEmailIsNotManagedDomain(ownerEmail);

      if (action === "create") {
        const apiToken = crypto.randomBytes(32).toString("hex");
        const apiTokenHash32 = sha256Buffer(apiToken);
        const days = Number(pending.days || 0);
        const expiresAtDays = Number.isFinite(days) && days > 0 && days <= 9999 ? days : 1;
        const createdIpPacked = packIp16(params.ip);
        const ua = params.userAgent.slice(0, 255);
        const automaticRenew = Number(pending.automatic_renew ?? 0) === 1;

        await this.apiTokensRepository.createToken(
          {
            ownerEmail,
            tokenHash32: apiTokenHash32,
            days: expiresAtDays,
            automaticRenew,
            createdIpPacked,
            userAgentOrNull: ua || null,
          },
          connection,
        );

        await this.markPendingConfirmed(pending.id, connection);

        return {
          status: 200,
          body: {
            ok: true,
            action: "api_credentials_confirm",
            confirmed: true,
            email: ownerEmail,
            token: apiToken,
            token_type: "api_key",
            expires_in_days: expiresAtDays,
            automatic_renew: automaticRenew,
          },
          isSuccess: true,
          successPayload: {
            email: ownerEmail,
            token: apiToken,
            expiresInDays: expiresAtDays,
          },
        } as const;
      }

      if (action === "list") {
        await this.markPendingConfirmed(pending.id, connection);
        return {
          status: 200,
          body: {
            ok: true,
            action: "api_credentials_list_confirm",
            confirmed: true,
            email: ownerEmail,
            items: await this.apiTokensRepository.listActiveByOwnerEmail(ownerEmail),
          },
          isSuccess: true,
        } as const;
      }

      const existingCount = await this.apiTokensRepository.countByOwnerEmail(ownerEmail, connection);
      await this.markPendingConfirmed(pending.id, connection);
      if (existingCount <= 0) {
        return {
          status: 404,
          body: {
            ok: false,
            action: "api_credentials_destroy_all_confirm",
            error: "no_api_keys",
            email: ownerEmail,
          },
          isSuccess: false,
        } as const;
      }

      const deletedCount = await this.apiTokensRepository.deleteByOwnerEmail(ownerEmail, connection);
      return {
        status: 200,
        body: {
          ok: true,
          action: "api_credentials_destroy_all_confirm",
          confirmed: true,
          email: ownerEmail,
          destroyed: true,
          deleted_count: deletedCount,
        },
        isSuccess: true,
      } as const;
    });

    return result;
  }

  private async requestVerifiedEmailAction(params: {
    action: Exclude<ApiTokenRequestAction, "create">;
    responseAction: string;
    emailRaw: unknown;
    ip: string | undefined;
    userAgent: string;
  }): Promise<Record<string, unknown>> {
    const email = normalizeEmailStrict(params.emailRaw);
    if (!email) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "email" });
    }

    await this.assertRequestAllowedForEmail(email, params.ip);
    await this.assertOwnerEmailIsNotManagedDomain(email);

    const result = await this.apiCredentialsEmailService.sendApiTokenRequestEmail({
      email,
      action: params.action,
      requestIpText: params.ip,
      userAgent: params.userAgent,
    });

    return {
      ok: true,
      action: params.responseAction,
      email,
      confirmation: this.toConfirmationBody(result),
    };
  }

  private async getUsableTokenByPlaintext(
    apiKey: string,
    ip: string | undefined,
  ): Promise<ApiTokenRow> {
    if (ip) {
      const ban = await this.banPolicyService.findActiveIpBan(ip);
      if (ban) {
        throw new PublicHttpException(403, { error: "banned", ban });
      }
    }

    const tokenHash32 = sha256Buffer(apiKey);
    const tokenRow = await this.apiTokensRepository.getActiveByTokenHash(tokenHash32);
    if (!tokenRow) {
      throw new PublicHttpException(401, { error: "invalid_or_expired_api_key" });
    }

    const banEmail = await this.banPolicyService.findActiveEmailOrDomainBan(tokenRow.owner_email);
    if (banEmail) {
      throw new PublicHttpException(403, { error: "banned", ban: banEmail });
    }

    return tokenRow;
  }

  private async assertRequestAllowedForEmail(
    email: string,
    ip: string | undefined,
  ): Promise<void> {
    if (ip) {
      const ban = await this.banPolicyService.findActiveIpBan(ip);
      if (ban) {
        throw new PublicHttpException(403, { error: "banned", ban });
      }
    }

    const banEmail = await this.banPolicyService.findActiveEmailOrDomainBan(email);
    if (banEmail) {
      throw new PublicHttpException(403, { error: "banned", ban: banEmail });
    }
  }

  private async assertOwnerEmailIsNotManagedDomain(email: string): Promise<void> {
    const parsed = parseMailbox(email);
    if (!parsed) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "email" });
    }

    const managedDomain = await this.domainRepository.getAdminActiveByName(parsed.domain);
    if (managedDomain) {
      throw new PublicHttpException(400, {
        error: "managed_domain_not_allowed",
        field: "email",
        domain: parsed.domain,
      });
    }
  }

  private async getActiveMetadataOrEmpty(id: number): Promise<ApiTokenPublicMetadata | Record<string, never>> {
    return (await this.apiTokensRepository.getActiveMetadataById(id)) ?? {};
  }

  private async markPendingConfirmed(
    id: number,
    connection: unknown,
  ): Promise<void> {
    const okConfirm = await this.apiTokenRequestsRepository.markConfirmedById(
      id,
      connection as Parameters<ApiTokenRequestsRepository["markConfirmedById"]>[1],
    );
    if (!okConfirm) {
      throw new Error("api_credentials_confirm_commit_failed");
    }
  }

  private parseConfirmationToken(tokenRaw: unknown): string {
    const token = normalizeConfirmationCode(tokenRaw);
    if (!token) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "token" });
    }
    if (!isConfirmationCodeValid(token)) {
      throw new PublicHttpException(400, { error: "invalid_token" });
    }
    return token;
  }

  private parseDays(raw: unknown, max: number): number | null {
    const str = typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : "";
    const num = Number(str);
    if (!Number.isInteger(num)) return null;
    if (num <= 0 || num > max) return null;
    return num;
  }

  private parseOptionalBoolean(
    raw: unknown,
    fallback: boolean | undefined,
  ): boolean | null | undefined {
    if (raw === undefined) return fallback;
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "number") {
      if (raw === 1) return true;
      if (raw === 0) return false;
      return null;
    }

    if (typeof raw !== "string") return null;
    const normalized = raw.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    return null;
  }

  private normalizeApiKey(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    const value = raw.trim().toLowerCase();
    return RE_API_KEY.test(value) ? value : null;
  }

  private toConfirmationBody(result: {
    sent: boolean;
    ttl_minutes?: number;
    reason?: string;
    pending?: {
      expires_at?: Date | null;
      last_sent_at?: Date | null;
      next_allowed_send_at?: Date | null;
      send_count?: number;
      remaining_attempts?: number;
    } | null;
  }): Record<string, unknown> {
    const confirmation: Record<string, unknown> = {
      sent: Boolean(result.sent),
      ttl_minutes: Number(result.ttl_minutes ?? 15),
    };

    if (result.reason) {
      confirmation.reason = result.reason;
      confirmation.status = "PENDING";
    }

    if (result.pending) {
      confirmation.status = (confirmation.status as string) || "PENDING";
      confirmation.expires_at = result.pending.expires_at ?? null;
      confirmation.last_sent_at = result.pending.last_sent_at ?? null;
      confirmation.next_allowed_send_at = result.pending.next_allowed_send_at ?? null;
      confirmation.send_count = Number(result.pending.send_count ?? 0);
      confirmation.remaining_attempts = Number(result.pending.remaining_attempts ?? 0);
    }

    return confirmation;
  }
}
