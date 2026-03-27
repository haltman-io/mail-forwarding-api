import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseInterceptors } from "@nestjs/common";
import type { Response } from "express";

import { SensitiveHeadersInterceptor } from "../../shared/http/sensitive-headers.interceptor.js";
import {
  AdminBansListQueryDto,
  AdminCreateBanDto,
  AdminUpdateBanDto,
} from "./admin.dto.js";
import { AdminBansService } from "./admin-bans-api-tokens.service.js";

@Controller("admin/bans")
@UseInterceptors(SensitiveHeadersInterceptor)
export class AdminBansController {
  constructor(private readonly adminBansService: AdminBansService) {}

  @Get()
  async listBans(
    @Query() query: AdminBansListQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    response.status(200).json(await this.adminBansService.listBans(query));
  }

  @Get(":id")
  async getBan(@Param("id") id: string, @Res() response: Response): Promise<void> {
    response.status(200).json(await this.adminBansService.getBanById(id));
  }

  @Post()
  async createBan(@Body() dto: AdminCreateBanDto, @Res() response: Response): Promise<void> {
    response.status(201).json(await this.adminBansService.createBan(dto));
  }

  @Patch(":id")
  async updateBan(
    @Param("id") id: string,
    @Body() dto: AdminUpdateBanDto,
    @Res() response: Response,
  ): Promise<void> {
    response.status(200).json(await this.adminBansService.updateBan(id, dto));
  }

  @Delete(":id")
  async deleteBan(@Param("id") id: string, @Res() response: Response): Promise<void> {
    response.status(200).json(await this.adminBansService.deleteBan(id));
  }
}
