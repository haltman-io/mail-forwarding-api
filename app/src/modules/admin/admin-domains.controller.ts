import { Controller, Delete, Get, Param, Patch, Post, Query, Res, Body, UseInterceptors } from "@nestjs/common";
import type { Response } from "express";

import { SensitiveHeadersInterceptor } from "../../shared/http/sensitive-headers.interceptor.js";
import {
  AdminCreateDomainDto,
  AdminDomainsListQueryDto,
  AdminUpdateDomainDto,
} from "./admin.dto.js";
import { AdminDomainsService } from "./admin-session-domains.service.js";

@Controller("admin/domains")
@UseInterceptors(SensitiveHeadersInterceptor)
export class AdminDomainsController {
  constructor(private readonly adminDomainsService: AdminDomainsService) {}

  @Get()
  async listDomains(
    @Query() query: AdminDomainsListQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    response.status(200).json(await this.adminDomainsService.listDomains(query));
  }

  @Get(":id")
  async getDomain(@Param("id") id: string, @Res() response: Response): Promise<void> {
    response.status(200).json(await this.adminDomainsService.getDomainById(id));
  }

  @Post()
  async createDomain(
    @Body() dto: AdminCreateDomainDto,
    @Res() response: Response,
  ): Promise<void> {
    response.status(201).json(await this.adminDomainsService.createDomain(dto));
  }

  @Patch(":id")
  async updateDomain(
    @Param("id") id: string,
    @Body() dto: AdminUpdateDomainDto,
    @Res() response: Response,
  ): Promise<void> {
    response.status(200).json(await this.adminDomainsService.updateDomain(id, dto));
  }

  @Delete(":id")
  async deleteDomain(@Param("id") id: string, @Res() response: Response): Promise<void> {
    response.status(200).json(await this.adminDomainsService.deleteDomain(id));
  }
}
