import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseInterceptors } from "@nestjs/common";
import type { Response } from "express";

import { SensitiveHeadersInterceptor } from "../../shared/http/sensitive-headers.interceptor.js";
import {
  AdminCreateDnsRequestDto,
  AdminDnsRequestsListQueryDto,
  AdminUpdateDnsRequestDto,
} from "./admin.dto.js";
import { AdminDnsRequestsService } from "./admin-dns-requests.service.js";

@Controller("admin/dns-requests")
@UseInterceptors(SensitiveHeadersInterceptor)
export class AdminDnsRequestsController {
  constructor(private readonly adminDnsRequestsService: AdminDnsRequestsService) {}

  @Get()
  async listDnsRequests(
    @Query() query: AdminDnsRequestsListQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    response.status(200).json(await this.adminDnsRequestsService.listDnsRequests(query));
  }

  @Get(":id")
  async getDnsRequest(@Param("id") id: string, @Res() response: Response): Promise<void> {
    response.status(200).json(await this.adminDnsRequestsService.getDnsRequestById(id));
  }

  @Post()
  async createDnsRequest(
    @Body() dto: AdminCreateDnsRequestDto,
    @Res() response: Response,
  ): Promise<void> {
    response.status(201).json(await this.adminDnsRequestsService.createDnsRequest(dto));
  }

  @Patch(":id")
  async updateDnsRequest(
    @Param("id") id: string,
    @Body() dto: AdminUpdateDnsRequestDto,
    @Res() response: Response,
  ): Promise<void> {
    response.status(200).json(await this.adminDnsRequestsService.updateDnsRequest(id, dto));
  }

  @Delete(":id")
  async deleteDnsRequest(@Param("id") id: string, @Res() response: Response): Promise<void> {
    response.status(200).json(await this.adminDnsRequestsService.deleteDnsRequest(id));
  }
}
