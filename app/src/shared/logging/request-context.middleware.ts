import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

import { AppLogger } from "./app-logger.service.js";

type RequestWithContext = Request & {
  requestId?: string;
  startedAtHrTime?: bigint;
};

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly logger: AppLogger) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const requestWithContext = request as RequestWithContext;
    this.logger.ensureRequestId(request, response);
    const startedAt = process.hrtime.bigint();
    requestWithContext.startedAtHrTime = startedAt;

    this.logger.info(
      "request.start",
      this.logger.requestContext(request),
    );

    response.on("finish", () => {
      const endedAt = process.hrtime.bigint();
      const durationMs = Number(endedAt - startedAt) / 1e6;

      this.logger.info("request.end", {
        ...this.logger.requestContext(request),
        status: response.statusCode,
        duration_ms: Math.round(durationMs),
      });
    });

    next();
  }
}
