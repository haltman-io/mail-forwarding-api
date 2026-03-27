import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";

import { PublicHttpException } from "../errors/public-http.exception.js";

@Injectable()
export class RequireJsonContentTypeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (request.is("application/json")) {
      return true;
    }

    throw new PublicHttpException(415, {
      error: "unsupported_media_type",
    });
  }
}
