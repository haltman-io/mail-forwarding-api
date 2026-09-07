import { Body, Controller, Get, HttpCode, Post, Query, UseInterceptors } from "@nestjs/common";

import { SensitiveHeadersInterceptor } from "../../../shared/http/sensitive-headers.interceptor.js";
import { AdminRateLimitTargetDto } from "../dto/admin.dto.js";
import { AdminRateLimitService } from "./admin-rate-limit.service.js";

@Controller("admin/rate-limit")
@UseInterceptors(SensitiveHeadersInterceptor)
export class AdminRateLimitController {
  constructor(private readonly adminRateLimitService: AdminRateLimitService) {}

  @Get("check")
  async checkRateLimit(@Query() query: AdminRateLimitTargetDto) {
    return this.adminRateLimitService.checkRateLimit(query);
  }

  @Post("reset")
  @HttpCode(200)
  async resetRateLimit(@Body() dto: AdminRateLimitTargetDto) {
    return this.adminRateLimitService.resetRateLimit(dto);
  }
}
