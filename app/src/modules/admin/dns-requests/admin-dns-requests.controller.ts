import { Body, Controller, Delete, Get, Param, Patch, Post, Query, HttpCode, UseInterceptors } from "@nestjs/common";

import { SensitiveHeadersInterceptor } from "../../../shared/http/sensitive-headers.interceptor.js";
import {
  AdminCreateDnsRequestDto,
  AdminDnsRequestsListQueryDto,
  AdminUpdateDnsRequestDto,
} from "../dto/admin.dto.js";
import { ParseIdPipe } from "../pipes/parse-id.pipe.js";
import { AdminDnsRequestsService } from "./admin-dns-requests.service.js";

@Controller("admin/dns-requests")
@UseInterceptors(SensitiveHeadersInterceptor)
export class AdminDnsRequestsController {
  constructor(private readonly adminDnsRequestsService: AdminDnsRequestsService) {}

  @Get()
  async listDnsRequests(@Query() query: AdminDnsRequestsListQueryDto) {
    return this.adminDnsRequestsService.listDnsRequests(query);
  }

  @Get(":id")
  async getDnsRequest(@Param("id", ParseIdPipe) id: number) {
    return this.adminDnsRequestsService.getDnsRequestById(id);
  }

  @Post()
  async createDnsRequest(@Body() dto: AdminCreateDnsRequestDto) {
    return this.adminDnsRequestsService.createDnsRequest(dto);
  }

  @Patch(":id")
  async updateDnsRequest(@Param("id", ParseIdPipe) id: number, @Body() dto: AdminUpdateDnsRequestDto) {
    return this.adminDnsRequestsService.updateDnsRequest(id, dto);
  }

  @Delete(":id")
  @HttpCode(200)
  async deleteDnsRequest(@Param("id", ParseIdPipe) id: number) {
    return this.adminDnsRequestsService.deleteDnsRequest(id);
  }
}
