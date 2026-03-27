import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseInterceptors } from "@nestjs/common";
import type { Response } from "express";

import { SensitiveHeadersInterceptor } from "../../shared/http/sensitive-headers.interceptor.js";
import {
  AdminCreateHandleDto,
  AdminHandlesListQueryDto,
  AdminUpdateHandleDto,
} from "./admin.dto.js";
import { AdminHandlesService } from "./admin-aliases-handles.service.js";

@Controller("admin/handles")
@UseInterceptors(SensitiveHeadersInterceptor)
export class AdminHandlesController {
  constructor(private readonly adminHandlesService: AdminHandlesService) {}

  @Get()
  async listHandles(
    @Query() query: AdminHandlesListQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    response.status(200).json(await this.adminHandlesService.listHandles(query));
  }

  @Get(":id")
  async getHandle(@Param("id") id: string, @Res() response: Response): Promise<void> {
    response.status(200).json(await this.adminHandlesService.getHandleById(id));
  }

  @Post()
  async createHandle(
    @Body() dto: AdminCreateHandleDto,
    @Res() response: Response,
  ): Promise<void> {
    response.status(201).json(await this.adminHandlesService.createHandle(dto));
  }

  @Patch(":id")
  async updateHandle(
    @Param("id") id: string,
    @Body() dto: AdminUpdateHandleDto,
    @Res() response: Response,
  ): Promise<void> {
    response.status(200).json(await this.adminHandlesService.updateHandle(id, dto));
  }

  @Delete(":id")
  async deleteHandle(@Param("id") id: string, @Res() response: Response): Promise<void> {
    response.status(200).json(await this.adminHandlesService.deleteHandle(id));
  }
}
