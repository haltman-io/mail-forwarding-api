import { Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { CorsOptions, CorsOptionsDelegate } from "cors";

import { TenantOriginPolicyService } from "../tenancy/tenant-origin-policy.service.js";

@Injectable()
export class CorsPolicyFactory {
  constructor(private readonly originPolicy: TenantOriginPolicyService) {}

  asDelegate(): CorsOptionsDelegate<Request> {
    return (request, callback) => {
      callback(null, this.createForRequest(request));
    };
  }

  createForRequest(request: Request): CorsOptions {
    const originHeader = request.header("origin");
    const allowedOrigin = this.originPolicy.resolveAllowedOrigin(originHeader);

    if (!allowedOrigin) {
      return {
        origin: false,
        credentials: false,
        optionsSuccessStatus: 204,
      };
    }

    return {
      origin: allowedOrigin,
      credentials: this.originPolicy.shouldAllowCredentials(originHeader),
      optionsSuccessStatus: 204,
    };
  }
}
