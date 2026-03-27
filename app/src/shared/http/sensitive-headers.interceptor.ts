import {
  CallHandler,
  ExecutionContext,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { Response } from "express";
import type { Observable } from "rxjs";

@Injectable()
export class SensitiveHeadersInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();
    response.set("Cache-Control", "no-store, private");
    response.set("Pragma", "no-cache");
    response.set("Referrer-Policy", "no-referrer");
    return next.handle();
  }
}
