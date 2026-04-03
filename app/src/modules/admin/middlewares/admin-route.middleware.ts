import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

import { AppLogger } from "../../../shared/logging/app-logger.service.js";
import { AuthSessionContextService } from "../../auth/services/auth-session-context.service.js";

@Injectable()
export class AdminRouteMiddleware implements NestMiddleware {
  constructor(
    private readonly authSessionContextService: AuthSessionContextService,
    private readonly logger: AppLogger,
  ) {}

  async use(request: Request, response: Response, next: NextFunction): Promise<void> {
    try {
      const authContext = await this.authSessionContextService.resolveAccessSession(request);

      if (!authContext) {
        response.status(401).json({ error: "invalid_or_expired_session" });
        return;
      }

      if (Number(authContext.is_admin || 0) !== 1) {
        response.status(403).json({ error: "forbidden" });
        return;
      }

      request.admin_auth = authContext;
      next();
    } catch (error) {
      this.logger.logError("admin.auth.error", error, request);
      response.status(500).json({ error: "internal_error" });
    }
  }
}
