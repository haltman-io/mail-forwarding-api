import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res, UseInterceptors } from "@nestjs/common";
import type { Response } from "express";

import { SensitiveHeadersInterceptor } from "../../../shared/http/sensitive-headers.interceptor.js";
import {
  AdminCreateDomainDto,
  AdminDomainsListQueryDto,
  AdminUpdateDomainDto,
} from "../dto/admin.dto.js";
import { ParseIdPipe } from "../pipes/parse-id.pipe.js";
import { AdminDomainsService } from "./admin-domains.service.js";
import type { AdminDnsRecheckResult } from "./admin-domains.service.js";

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

  @Post("recheckdns/all")
  async recheckAllDomains(@Res() response: Response): Promise<void> {
    const result = await this.adminDomainsService.recheckAllDomains();
    this.sendRelayResponse(response, result);
  }

  @Post(":id/recheckdns")
  async recheckDomain(
    @Param("id", ParseIdPipe) id: number,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.adminDomainsService.recheckDomain(id);
    this.sendRelayResponse(response, result);
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

  private sendRelayResponse(response: Response, result: AdminDnsRecheckResult): void {
    if (result.payload === undefined) {
      response.status(result.status).end();
      return;
    }

    if (Buffer.isBuffer(result.payload)) {
      response.status(result.status).send(result.payload);
      return;
    }

    if (typeof result.payload === "string") {
      response.status(result.status).send(result.payload);
      return;
    }

    response.status(result.status).json(result.payload);
  }
}
