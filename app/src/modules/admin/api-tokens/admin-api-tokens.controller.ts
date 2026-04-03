import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, HttpCode, UseInterceptors } from "@nestjs/common";
import type { Request } from "express";

import { SensitiveHeadersInterceptor } from "../../../shared/http/sensitive-headers.interceptor.js";
import {
  AdminApiTokensListQueryDto,
  AdminCreateApiTokenDto,
  AdminUpdateApiTokenDto,
} from "../dto/admin.dto.js";
import { ParseIdPipe } from "../pipes/parse-id.pipe.js";
import { AdminApiTokensService } from "./admin-api-tokens.service.js";

@Controller("admin/api-tokens")
@UseInterceptors(SensitiveHeadersInterceptor)
export class AdminApiTokensController {
  constructor(private readonly adminApiTokensService: AdminApiTokensService) {}

  @Get()
  async listApiTokens(@Query() query: AdminApiTokensListQueryDto) {
    return this.adminApiTokensService.listApiTokens(query);
  }

  @Get(":id")
  async getApiToken(@Param("id", ParseIdPipe) id: number) {
    return this.adminApiTokensService.getApiTokenById(id);
  }

  @Post()
  async createApiToken(@Body() dto: AdminCreateApiTokenDto, @Req() request: Request) {
    return this.adminApiTokensService.createApiToken(dto, {
      ip: String(request.ip || ""),
      userAgent: String(request.headers["user-agent"] || ""),
    });
  }

  @Patch(":id")
  async updateApiToken(@Param("id", ParseIdPipe) id: number, @Body() dto: AdminUpdateApiTokenDto) {
    return this.adminApiTokensService.updateApiToken(id, dto);
  }

  @Delete(":id")
  @HttpCode(200)
  async deleteApiToken(@Param("id", ParseIdPipe) id: number) {
    return this.adminApiTokensService.deleteApiToken(id);
  }
}
