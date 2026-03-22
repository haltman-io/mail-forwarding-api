import {
  ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import type { Request, Response } from "express";

import { AppLogger } from "../logging/app-logger.service.js";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: AppLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();

    if (!(exception instanceof HttpException)) {
      this.logger.logError("request.error", exception, request);
      response.status(500).json({ error: "internal_error" });
      return;
    }

    const status = exception.getStatus();
    const body = this.normalizeResponseBody(exception.getResponse(), status);

    if (status >= 500) {
      this.logger.logError("request.error", exception, request, { status });
    }

    response.status(status).json(body);
  }

  private normalizeResponseBody(
    exceptionResponse: string | object,
    status: number,
  ): Record<string, unknown> {
    if (
      typeof exceptionResponse === "object" &&
      exceptionResponse !== null &&
      "error" in exceptionResponse
    ) {
      return exceptionResponse as Record<string, unknown>;
    }

    switch (status) {
      case 400:
        return { error: "invalid_params" };
      case 404:
        return { error: "not_found" };
      case 415:
        return { error: "unsupported_media_type" };
      default:
        return { error: "internal_error" };
    }
  }
}
