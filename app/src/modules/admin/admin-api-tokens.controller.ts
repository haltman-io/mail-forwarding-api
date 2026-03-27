import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseInterceptors } from "@nestjs/common";
import type { Request, Response } from "express";

import { SensitiveHeadersInterceptor } from "../../shared/http/sensitive-headers.interceptor.js";
import {
  AdminApiTokensListQueryDto,
  AdminCreateApiTokenDto,
  AdminUpdateApiTokenDto,
} from "./admin.dto.js";
import { AdminApiTokensService } from "./admin-bans-api-tokens.service.js";

@Controller("admin/api-tokens")
@UseInterceptors(SensitiveHeadersInterceptor)
export class AdminApiTokensController {
  constructor(private readonly adminApiTokensService: AdminApiTokensService) {}

  @Get()
  async listApiTokens(
    @Query() query: AdminApiTokensListQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    response.status(200).json(await this.adminApiTokensService.listApiTokens(query));
  }

  @Get(":id")
  async getApiToken(@Param("id") id: string, @Res() response: Response): Promise<void> {
    response.status(200).json(await this.adminApiTokensService.getApiTokenById(id));
  }

  @Post()
  async createApiToken(
    @Body() dto: AdminCreateApiTokenDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    response.status(201).json(
      await this.adminApiTokensService.createApiToken(dto, {
        ip: String(request.ip || ""),
        userAgent: String(request.headers["user-agent"] || ""),
      }),
    );
  }

  @Patch(":id")
  async updateApiToken(
    @Param("id") id: string,
    @Body() dto: AdminUpdateApiTokenDto,
    @Res() response: Response,
  ): Promise<void> {
    response.status(200).json(await this.adminApiTokensService.updateApiToken(id, dto));
  }

  @Delete(":id")
  async deleteApiToken(@Param("id") id: string, @Res() response: Response): Promise<void> {
    response.status(200).json(await this.adminApiTokensService.deleteApiToken(id));
  }
}
