import {
  CallHandler,
  ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { Request } from "express";
import { type Observable, tap } from "rxjs";

import { packIp16 } from "../../../shared/utils/ip-pack.js";
import { ApiLogsRepository } from "../repositories/api-logs.repository.js";

function safeJsonStringify(obj: unknown): string | null {
  try {
    return JSON.stringify(obj ?? null);
  } catch {
    return null;
  }
}

@Injectable()
export class ApiLogInterceptor implements NestInterceptor {
  constructor(private readonly apiLogsRepository: ApiLogsRepository) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.api_token ?? null;

    this.apiLogsRepository
      .insert({
        apiTokenId: token?.id ?? null,
        ownerEmail: token?.owner_email ?? null,
        route: String(request.originalUrl || request.path || "").slice(0, 128),
        body: safeJsonStringify(request.body),
        requestIpPacked: packIp16(request.ip),
        userAgent: String(request.headers["user-agent"] || "").slice(0, 255),
      })
      .catch(() => {});

    return next.handle().pipe(tap());
  }
}
