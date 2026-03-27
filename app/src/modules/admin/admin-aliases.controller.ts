import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseInterceptors } from "@nestjs/common";
import type { Response } from "express";

import { SensitiveHeadersInterceptor } from "../../shared/http/sensitive-headers.interceptor.js";
import {
  AdminAliasesListQueryDto,
  AdminCreateAliasDto,
  AdminUpdateAliasDto,
} from "./admin.dto.js";
import { AdminAliasesService } from "./admin-aliases-handles.service.js";

@Controller("admin/aliases")
@UseInterceptors(SensitiveHeadersInterceptor)
export class AdminAliasesController {
  constructor(private readonly adminAliasesService: AdminAliasesService) {}

  @Get()
  async listAliases(
    @Query() query: AdminAliasesListQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    response.status(200).json(await this.adminAliasesService.listAliases(query));
  }

  @Get(":id")
  async getAlias(@Param("id") id: string, @Res() response: Response): Promise<void> {
    response.status(200).json(await this.adminAliasesService.getAliasById(id));
  }

  @Post()
  async createAlias(
    @Body() dto: AdminCreateAliasDto,
    @Res() response: Response,
  ): Promise<void> {
    response.status(201).json(await this.adminAliasesService.createAlias(dto));
  }

  @Patch(":id")
  async updateAlias(
    @Param("id") id: string,
    @Body() dto: AdminUpdateAliasDto,
    @Res() response: Response,
  ): Promise<void> {
    response.status(200).json(await this.adminAliasesService.updateAlias(id, dto));
  }

  @Delete(":id")
  async deleteAlias(@Param("id") id: string, @Res() response: Response): Promise<void> {
    response.status(200).json(await this.adminAliasesService.deleteAlias(id));
  }
}
