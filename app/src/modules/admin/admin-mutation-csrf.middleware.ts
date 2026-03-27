import { Injectable, type NestMiddleware } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { NextFunction, Request, Response } from "express";

import { AppLogger } from "../../shared/logging/app-logger.service.js";
import { isCsrfTokenValid, readCsrfHeader } from "../../shared/utils/csrf.js";

interface AuthSettings {
  csrfSecret: string;
}

@Injectable()
export class AdminMutationCsrfMiddleware implements NestMiddleware {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: AppLogger,
  ) {}

  use(request: Request, response: Response, next: NextFunction): void {
    try {
      const authContext = request.admin_auth;
      if (!authContext?.session_family_id) {
        response.status(401).json({ error: "invalid_or_expired_session" });
        return;
      }

      const csrfToken = readCsrfHeader(request);
      if (!csrfToken) {
        response.status(403).json({ error: "csrf_required" });
        return;
      }

      const authSettings = this.configService.getOrThrow<AuthSettings>("auth");
      if (
        !isCsrfTokenValid(
          authContext.session_family_id,
          csrfToken,
          authSettings.csrfSecret,
        )
      ) {
        response.status(403).json({ error: "invalid_csrf_token" });
        return;
      }

      next();
    } catch (error) {
      this.logger.logError("admin.csrf.error", error, request);
      response.status(500).json({ error: "internal_error" });
    }
  }
}
