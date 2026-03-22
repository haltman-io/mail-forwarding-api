import { Controller, Get, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import crypto from "node:crypto";

import { AppLogger } from "../../shared/logging/app-logger.service.js";
import { sha256Buffer } from "../../shared/utils/crypto.js";
import { packIp16 } from "../../shared/utils/ip-pack.js";
import { DatabaseService } from "../../shared/database/database.service.js";
import {
  isConfirmationCodeValid,
  normalizeConfirmationCode,
} from "../../shared/utils/confirmation-code.js";
import { BanPolicyService } from "../bans/ban-policy.service.js";
import { ApiTokensRepository } from "./repositories/api-tokens.repository.js";
import { ApiTokenRequestsRepository } from "./repositories/api-token-requests.repository.js";
import { ApiCredentialsEmailService } from "./services/api-credentials-email.service.js";

const MAX_EMAIL_LEN = 254;
const RE_DOMAIN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const RE_EMAIL_LOCAL = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

function normStr(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function parseEmailStrict(
  email: unknown,
): { email: string; local: string; domain: string } | null {
  const value = normStr(email);
  if (!value || value.length > MAX_EMAIL_LEN) return null;

  const at = value.indexOf("@");
  if (at <= 0) return null;
  if (value.indexOf("@", at + 1) !== -1) return null;

  const local = value.slice(0, at);
  const domain = value.slice(at + 1);

  if (!RE_EMAIL_LOCAL.test(local)) return null;
  if (!RE_DOMAIN.test(domain)) return null;

  return { email: value, local, domain };
}

function parseDays(raw: unknown): number | null {
  const str = typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : "";
  const num = Number(str);
  if (!Number.isInteger(num)) return null;
  if (num <= 0 || num > 90) return null;
  return num;
}

@Controller()
export class ApiCredentialsController {
  constructor(
    private readonly apiCredentialsEmailService: ApiCredentialsEmailService,
    private readonly apiTokenRequestsRepository: ApiTokenRequestsRepository,
    private readonly apiTokensRepository: ApiTokensRepository,
    private readonly banPolicyService: BanPolicyService,
    private readonly databaseService: DatabaseService,
    private readonly logger: AppLogger,
  ) {}

  @Post("api/credentials/create")
  async createCredentials(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const body = req.body as Record<string, unknown> | undefined;
      const query = req.query as Record<string, unknown>;

      const emailRaw = body?.email ?? query?.email;
      const daysRaw = body?.days ?? query?.days;

      const parsedEmail = parseEmailStrict(emailRaw);
      if (!parsedEmail) {
        res.status(400).json({ error: "invalid_params", field: "email" });
        return;
      }

      const days = parseDays(daysRaw);
      if (!days) {
        res.status(400).json({ error: "invalid_params", field: "days", hint: "integer 1..90" });
        return;
      }

      if (req.ip) {
        const ban = await this.banPolicyService.findActiveIpBan(req.ip);
        if (ban) {
          res.status(403).json({ error: "banned", ban });
          return;
        }
      }

      const banEmail = await this.banPolicyService.findActiveEmailOrDomainBan(parsedEmail.email);
      if (banEmail) {
        res.status(403).json({ error: "banned", ban: banEmail });
        return;
      }

      const result = await this.apiCredentialsEmailService.sendApiTokenRequestEmail({
        email: parsedEmail.email,
        days,
        requestIpText: req.ip,
        userAgent: String(req.headers["user-agent"] || ""),
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

      res.status(200).json({
        ok: true,
        action: "api_credentials_create",
        email: parsedEmail.email,
        days,
        confirmation,
      });
    } catch (err) {
      const e = err as { code?: string };
      if (e?.code === "tx_busy") {
        res.status(503).json({ error: "temporarily_unavailable" });
        return;
      }
      this.logger.logError("api.createCredentials.error", err, req);
      res.status(500).json({ error: "internal_error" });
    }
  }

  @Get("api/credentials/confirm")
  async confirmCredentials(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const query = req.query as Record<string, unknown>;
      const rawToken = typeof query?.token === "string" ? query.token : "";
      const token = normalizeConfirmationCode(rawToken);

      if (!token) {
        res.status(400).json({ error: "invalid_params", field: "token" });
        return;
      }

      if (!isConfirmationCodeValid(token)) {
        res.status(400).json({ error: "invalid_token" });
        return;
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
          } as const;
        }

        const apiToken = crypto.randomBytes(32).toString("hex");
        const apiTokenHash32 = sha256Buffer(apiToken);

        const days = Number(pending.days || 0);
        const expiresAtDays = Number.isFinite(days) && days > 0 && days <= 90 ? days : 1;
        const ownerEmail = String(pending.email).trim().toLowerCase();
        const createdIpPacked = packIp16(req.ip);
        const ua = String(req.headers["user-agent"] || "").slice(0, 255);

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
        } as const;
      });

      res.status(result.status).json(result.body);
    } catch (err) {
      this.logger.logError("api.confirmCredentials.error", err, req);
      res.status(500).json({ error: "internal_error" });
    }
  }
}
