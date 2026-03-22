import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";

import { PublicHttpException } from "../../../shared/errors/public-http.exception.js";
import { AppLogger } from "../../../shared/logging/app-logger.service.js";
import { sha256Buffer } from "../../../shared/utils/crypto.js";
import { ApiTokensRepository } from "../repositories/api-tokens.repository.js";

const RE_API_KEY = /^[a-z0-9]{64}$/;

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiTokensRepository: ApiTokensRepository,
    private readonly logger: AppLogger,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    try {
      const raw = String(request.header("X-API-Key") || "").trim().toLowerCase();

      if (!raw) {
        throw new PublicHttpException(401, { error: "missing_api_key" });
      }

      if (!RE_API_KEY.test(raw)) {
        throw new PublicHttpException(401, { error: "invalid_api_key_format" });
      }

      const tokenHash32 = sha256Buffer(raw);
      const tokenRow = await this.apiTokensRepository.getActiveByTokenHash(tokenHash32);

      if (!tokenRow) {
        throw new PublicHttpException(401, { error: "invalid_or_expired_api_key" });
      }

      request.api_token = {
        id: tokenRow.id,
        owner_email: tokenRow.owner_email,
      };

      this.apiTokensRepository.touchLastUsed(tokenRow.id).catch(() => {});

      return true;
    } catch (err) {
      if (err instanceof PublicHttpException) {
        throw err;
      }
      this.logger.logError("api.auth.error", err, request);
      throw new PublicHttpException(500, { error: "internal_error" });
    }
  }
}
