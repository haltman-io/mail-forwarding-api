import { Body, Controller, Delete, Get, Param, Patch, Post, Query, HttpCode, UseInterceptors } from "@nestjs/common";

import { SensitiveHeadersInterceptor } from "../../../shared/http/sensitive-headers.interceptor.js";
import {
  AdminCreateHandleDto,
  AdminHandlesListQueryDto,
  AdminUpdateHandleDto,
} from "../dto/admin.dto.js";
import { ParseIdPipe } from "../pipes/parse-id.pipe.js";
import { AdminHandlesService } from "./admin-handles.service.js";

@Controller("admin/handles")
@UseInterceptors(SensitiveHeadersInterceptor)
export class AdminHandlesController {
  constructor(private readonly adminHandlesService: AdminHandlesService) {}

  @Get()
  async listHandles(@Query() query: AdminHandlesListQueryDto) {
    return this.adminHandlesService.listHandles(query);
  }

  @Get(":id")
  async getHandle(@Param("id", ParseIdPipe) id: number) {
    return this.adminHandlesService.getHandleById(id);
  }

  @Post()
  async createHandle(@Body() dto: AdminCreateHandleDto) {
    return this.adminHandlesService.createHandle(dto);
  }

  @Patch(":id")
  async updateHandle(@Param("id", ParseIdPipe) id: number, @Body() dto: AdminUpdateHandleDto) {
    return this.adminHandlesService.updateHandle(id, dto);
  }

  @Delete(":id")
  @HttpCode(200)
  async deleteHandle(@Param("id", ParseIdPipe) id: number) {
    return this.adminHandlesService.deleteHandle(id);
  }
}
