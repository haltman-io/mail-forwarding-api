import { Global, Module } from "@nestjs/common";

import { HttpExceptionFilter } from "./errors/http-exception.filter.js";
import { AppLogger } from "./logging/app-logger.service.js";
import { CorsPolicyFactory } from "./security/cors-policy.factory.js";
import { TenantOriginPolicyService } from "./tenancy/tenant-origin-policy.service.js";

@Global()
@Module({
  providers: [AppLogger, HttpExceptionFilter, TenantOriginPolicyService, CorsPolicyFactory],
  exports: [AppLogger, HttpExceptionFilter, TenantOriginPolicyService, CorsPolicyFactory],
})
export class InfrastructureModule {}
