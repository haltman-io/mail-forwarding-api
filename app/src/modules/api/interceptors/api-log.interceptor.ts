import {
  CallHandler,
  ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Observable } from "rxjs";

import { AppLogger } from "../../../shared/logging/app-logger.service.js";
import { packIp16 } from "../../../shared/utils/ip-pack.js";
import { ApiLogsRepository } from "../repositories/api-logs.repository.js";

type RequestWithContext = Request & {
  requestId?: string;
};

type AuditSummary = {
  operation: string;
  status_code: number;
  outcome: "success" | "conflict" | "client_error" | "server_error";
  request_id: string | null;
  resource: {
    alias: string | null;
  };
};

function normalizeText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().toLowerCase();
}

function resolveAliasFromCreate(request: Request): string | null {
  const body = request.body as Record<string, unknown> | undefined;
  const query = request.query as Record<string, unknown> | undefined;
  const handle = normalizeText(body?.alias_handle ?? query?.alias_handle);
  const domain = normalizeText(body?.alias_domain ?? query?.alias_domain);

  if (!handle || !domain) {
    return null;
  }

  return `${handle}@${domain}`;
}

function resolveAliasFromDelete(request: Request): string | null {
  const body = request.body as Record<string, unknown> | undefined;
  const query = request.query as Record<string, unknown> | undefined;
  const alias = normalizeText(body?.alias ?? query?.alias);
  return alias || null;
}

@Injectable()
export class ApiLogInterceptor implements NestInterceptor {
  constructor(
    private readonly apiLogsRepository: ApiLogsRepository,
    private readonly logger: AppLogger,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const token = request.api_token ?? null;

    if (token?.id) {
      this.attachAuditOnFinish(request, response, token.id, token.owner_email ?? null);
    }

    return next.handle();
  }

  private attachAuditOnFinish(
    request: Request,
    response: Response,
    apiTokenId: number,
    ownerEmail: string | null,
  ): void {
    let recorded = false;

    response.once("finish", () => {
      if (recorded) {
        return;
      }
      recorded = true;
      void this.persistAudit(request, response, apiTokenId, ownerEmail);
    });
  }

  private async persistAudit(
    request: Request,
    response: Response,
    apiTokenId: number,
    ownerEmail: string | null,
  ): Promise<void> {
    const route = this.logger.sanitizeRequestPath(request.originalUrl || request.path || "");
    const summary = this.buildAuditSummary(request, response.statusCode, route);

    try {
      await this.apiLogsRepository.insert({
        apiTokenId,
        ownerEmail,
        route,
        body: JSON.stringify(summary),
        requestIpPacked: packIp16(request.ip),
        userAgent: String(request.headers["user-agent"] || "").slice(0, 255),
      });
    } catch (error) {
      this.logger.error("api.audit.insert.failed", {
        ...this.logger.requestContext(request),
        route,
        status_code: response.statusCode,
        err: error,
      });
    }
  }

  private buildAuditSummary(
    request: Request,
    statusCode: number,
    route: string,
  ): AuditSummary {
    const operation = this.resolveOperation(route, request.method);
    return {
      operation,
      status_code: statusCode,
      outcome: this.resolveOutcome(statusCode),
      request_id: (request as RequestWithContext).requestId ?? null,
      resource: {
        alias: this.resolveAlias(route, request),
      },
    };
  }

  private resolveOperation(route: string, method: string): string {
    const normalizedMethod = String(method || "").toUpperCase();
    if (normalizedMethod === "POST" && route === "/api/alias/create") {
      return "alias_create";
    }
    if (normalizedMethod === "POST" && route === "/api/alias/delete") {
      return "alias_delete";
    }
    if (normalizedMethod === "GET" && route === "/api/alias/list") {
      return "alias_list";
    }
    if (normalizedMethod === "GET" && route === "/api/alias/stats") {
      return "alias_stats";
    }
    if (normalizedMethod === "GET" && route === "/api/activity") {
      return "activity_list";
    }
    return "api_request";
  }

  private resolveOutcome(
    statusCode: number,
  ): "success" | "conflict" | "client_error" | "server_error" {
    if (statusCode >= 200 && statusCode < 300) {
      return "success";
    }
    if (statusCode === 409) {
      return "conflict";
    }
    if (statusCode >= 400 && statusCode < 500) {
      return "client_error";
    }
    return "server_error";
  }

  private resolveAlias(route: string, request: Request): string | null {
    if (route === "/api/alias/create") {
      return resolveAliasFromCreate(request);
    }
    if (route === "/api/alias/delete") {
      return resolveAliasFromDelete(request);
    }
    return null;
  }
}
