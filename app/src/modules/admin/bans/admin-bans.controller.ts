import { Body, Controller, Delete, Get, Param, Patch, Post, Query, HttpCode, UseInterceptors } from "@nestjs/common";

import { SensitiveHeadersInterceptor } from "../../../shared/http/sensitive-headers.interceptor.js";
import {
  AdminBansListQueryDto,
  AdminCreateBanDto,
  AdminUpdateBanDto,
} from "../dto/admin.dto.js";
import { ParseIdPipe } from "../pipes/parse-id.pipe.js";
import { AdminBansService } from "./admin-bans.service.js";

@Controller("admin/bans")
@UseInterceptors(SensitiveHeadersInterceptor)
export class AdminBansController {
  constructor(private readonly adminBansService: AdminBansService) {}

  @Get()
  async listBans(@Query() query: AdminBansListQueryDto) {
    return this.adminBansService.listBans(query);
  }

  @Get(":id")
  async getBan(@Param("id", ParseIdPipe) id: number) {
    return this.adminBansService.getBanById(id);
  }

  @Post()
  async createBan(@Body() dto: AdminCreateBanDto) {
    return this.adminBansService.createBan(dto);
  }

  @Patch(":id")
  async updateBan(@Param("id", ParseIdPipe) id: number, @Body() dto: AdminUpdateBanDto) {
    return this.adminBansService.updateBan(id, dto);
  }

  @Delete(":id")
  @HttpCode(200)
  async deleteBan(@Param("id", ParseIdPipe) id: number) {
    return this.adminBansService.deleteBan(id);
  }
}
