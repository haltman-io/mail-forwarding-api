import { Body, Controller, Delete, Get, Param, Patch, Post, Query, HttpCode, UseInterceptors } from "@nestjs/common";

import { SensitiveHeadersInterceptor } from "../../../shared/http/sensitive-headers.interceptor.js";
import {
  AdminAliasesListQueryDto,
  AdminCreateAliasDto,
  AdminUpdateAliasDto,
} from "../dto/admin.dto.js";
import { ParseIdPipe } from "../pipes/parse-id.pipe.js";
import { AdminAliasesService } from "./admin-aliases.service.js";

@Controller("admin/aliases")
@UseInterceptors(SensitiveHeadersInterceptor)
export class AdminAliasesController {
  constructor(private readonly adminAliasesService: AdminAliasesService) {}

  @Get()
  async listAliases(@Query() query: AdminAliasesListQueryDto) {
    return this.adminAliasesService.listAliases(query);
  }

  @Get(":id")
  async getAlias(@Param("id", ParseIdPipe) id: number) {
    return this.adminAliasesService.getAliasById(id);
  }

  @Post()
  async createAlias(@Body() dto: AdminCreateAliasDto) {
    return this.adminAliasesService.createAlias(dto);
  }

  @Patch(":id")
  async updateAlias(@Param("id", ParseIdPipe) id: number, @Body() dto: AdminUpdateAliasDto) {
    return this.adminAliasesService.updateAlias(id, dto);
  }

  @Delete(":id")
  @HttpCode(200)
  async deleteAlias(@Param("id", ParseIdPipe) id: number) {
    return this.adminAliasesService.deleteAlias(id);
  }
}
