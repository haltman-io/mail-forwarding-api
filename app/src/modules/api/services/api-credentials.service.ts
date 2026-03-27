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
import { DatabaseService } from "../../../shared/database/database.service.js";
import { BanPolicyService } from "../../bans/ban-policy.service.js";
import { ApiTokensRepository } from "../repositories/api-tokens.repository.js";
import { ApiTokenRequestsRepository } from "../repositories/api-token-requests.repository.js";
import { ApiCredentialsEmailService } from "./api-credentials-email.service.js";

@Injectable()
export class ApiCredentialsService {
  constructor(
    private readonly apiCredentialsEmailService: ApiCredentialsEmailService,
    private readonly apiTokenRequestsRepository: ApiTokenRequestsRepository,
    private readonly apiTokensRepository: ApiTokensRepository,
    private readonly banPolicyService: BanPolicyService,
    private readonly databaseService: DatabaseService,
    private readonly logger: AppLogger,
  ) {}

  async createCredentials(params: {
    email: unknown;
    days: unknown;
    ip: string | undefined;
    userAgent: string;
  }): Promise<Record<string, unknown>> {
    const email = normalizeEmailStrict(params.email);
    if (!email) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "email" });
    }

    const days = this.parseDays(params.days);
    if (!days) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "days", hint: "integer 1..90" });
    }

    if (params.ip) {
      const ban = await this.banPolicyService.findActiveIpBan(params.ip);
      if (ban) {
        throw new PublicHttpException(403, { error: "banned", ban });
      }
    }

    const banEmail = await this.banPolicyService.findActiveEmailOrDomainBan(email);
    if (banEmail) {
      throw new PublicHttpException(403, { error: "banned", ban: banEmail });
    }

    const result = await this.apiCredentialsEmailService.sendApiTokenRequestEmail({
      email,
      days,
      requestIpText: params.ip,
      userAgent: params.userAgent,
    });

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

    return {
      ok: true,
      action: "api_credentials_create",
      email,
      days,
      confirmation,
    };
  }

  async previewConfirmation(tokenRaw: unknown): Promise<{
    previewBody: Record<string, unknown>;
    token: string;
  }> {
    const token = normalizeConfirmationCode(tokenRaw);
    if (!token) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "token" });
    }
    if (!isConfirmationCodeValid(token)) {
      throw new PublicHttpException(400, { error: "invalid_token" });
    }

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
        email: String(pending.email || "").trim().toLowerCase(),
        days: Number(pending.days || 0),
      },
      token,
    };
  }

  async confirmCredentials(params: {
    tokenRaw: unknown;
    ip: string | undefined;
    userAgent: string;
  }): Promise<{
    status: number;
    body: Record<string, unknown>;
    isSuccess: boolean;
    successPayload?: { email: string; token: string; expiresInDays: number };
  }> {
    const token = normalizeConfirmationCode(params.tokenRaw);
    if (!token) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "token" });
    }
    if (!isConfirmationCodeValid(token)) {
      throw new PublicHttpException(400, { error: "invalid_token" });
    }

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

      const apiToken = crypto.randomBytes(32).toString("hex");
      const apiTokenHash32 = sha256Buffer(apiToken);

      const days = Number(pending.days || 0);
      const expiresAtDays = Number.isFinite(days) && days > 0 && days <= 90 ? days : 1;
      const ownerEmail = String(pending.email).trim().toLowerCase();
      const createdIpPacked = packIp16(params.ip);
      const ua = params.userAgent.slice(0, 255);

      await this.apiTokensRepository.createToken(
        {
          ownerEmail,
          tokenHash32: apiTokenHash32,
          days: expiresAtDays,
          createdIpPacked,
          userAgentOrNull: ua || null,
        },
        connection,
      );

      const okConfirm = await this.apiTokenRequestsRepository.markConfirmedById(
        pending.id,
        connection,
      );
      if (!okConfirm) {
        throw new Error("api_credentials_confirm_commit_failed");
      }

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
        },
        isSuccess: true,
        successPayload: {
          email: ownerEmail,
          token: apiToken,
          expiresInDays: expiresAtDays,
        },
      } as const;
    });

    return result;
  }

  private parseDays(raw: unknown): number | null {
    const str = typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : "";
    const num = Number(str);
    if (!Number.isInteger(num)) return null;
    if (num <= 0 || num > 90) return null;
    return num;
  }
}
