import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseInterceptors,
} from "@nestjs/common";
import type { Request } from "express";

import { SensitiveHeadersInterceptor } from "../../../shared/http/sensitive-headers.interceptor.js";
import {
  AdminCreateSmtpCredentialDto,
  AdminCreateSmtpInviteDto,
  AdminSmtpCredentialsListQueryDto,
  AdminUpdateSmtpCredentialDto,
} from "../dto/admin.dto.js";
import { AdminSmtpCredentialsService } from "./admin-smtp-credentials.service.js";

@Controller("admin/smtp-credentials")
@UseInterceptors(SensitiveHeadersInterceptor)
export class AdminSmtpCredentialsController {
  constructor(private readonly smtpCredentialsService: AdminSmtpCredentialsService) {}

  @Get()
  async listCredentials(@Query() query: AdminSmtpCredentialsListQueryDto) {
    return this.smtpCredentialsService.listCredentials(query);
  }

  @Post("invites")
  async createInvite(
    @Body() dto: AdminCreateSmtpInviteDto,
    @Req() request: Request,
  ) {
    return this.smtpCredentialsService.createInvite(dto, request.admin_auth!);
  }

  @Post()
  async createCredential(@Body() dto: AdminCreateSmtpCredentialDto) {
    return this.smtpCredentialsService.createCredential(dto);
  }

  @Patch(":username")
  async updateCredential(
    @Param("username") username: string,
    @Body() dto: AdminUpdateSmtpCredentialDto,
  ) {
    return this.smtpCredentialsService.updateCredential(username, dto);
  }

  @Delete(":username")
  async deleteCredential(@Param("username") username: string) {
    return this.smtpCredentialsService.deleteCredential(username);
  }
}
