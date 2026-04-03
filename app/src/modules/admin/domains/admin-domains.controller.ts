import { Controller, Delete, Get, Param, Patch, Post, Query, Body, HttpCode, UseInterceptors } from "@nestjs/common";

import { SensitiveHeadersInterceptor } from "../../../shared/http/sensitive-headers.interceptor.js";
import {
  AdminCreateDomainDto,
  AdminDomainsListQueryDto,
  AdminUpdateDomainDto,
} from "../dto/admin.dto.js";
import { ParseIdPipe } from "../pipes/parse-id.pipe.js";
import { AdminDomainsService } from "./admin-domains.service.js";

@Controller("admin/domains")
@UseInterceptors(SensitiveHeadersInterceptor)
export class AdminDomainsController {
  constructor(private readonly adminDomainsService: AdminDomainsService) {}

  @Get()
  async listDomains(@Query() query: AdminDomainsListQueryDto) {
    return this.adminDomainsService.listDomains(query);
  }

  @Get(":id")
  async getDomain(@Param("id", ParseIdPipe) id: number) {
    return this.adminDomainsService.getDomainById(id);
  }

  @Post()
  async createDomain(@Body() dto: AdminCreateDomainDto) {
    return this.adminDomainsService.createDomain(dto);
  }

  @Patch(":id")
  async updateDomain(@Param("id", ParseIdPipe) id: number, @Body() dto: AdminUpdateDomainDto) {
    return this.adminDomainsService.updateDomain(id, dto);
  }

  @Delete(":id")
  @HttpCode(200)
  async deleteDomain(@Param("id", ParseIdPipe) id: number) {
    return this.adminDomainsService.deleteDomain(id);
  }
}
