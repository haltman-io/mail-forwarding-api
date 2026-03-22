import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

import { BanPolicyService } from "../../modules/bans/ban-policy.service.js";
import { AppLogger } from "../logging/app-logger.service.js";

@Injectable()
export class IpBanMiddleware implements NestMiddleware {
  constructor(
    private readonly banPolicyService: BanPolicyService,
    private readonly logger: AppLogger,
  ) {}

  async use(request: Request, response: Response, next: NextFunction): Promise<void> {
    try {
      const ban = await this.banPolicyService.findActiveIpBan(String(request.ip || ""));
      if (ban) {
        response.status(403).json({ error: "banned", ban });
        return;
      }

      next();
    } catch (error) {
      this.logger.logError("ip_ban.check.error", error, request);
      response.status(500).json({ error: "internal_error" });
    }
  }
}
