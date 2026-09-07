import { Body, Controller, Get, Param, Post, UseInterceptors } from "@nestjs/common";

import { SensitiveHeadersInterceptor } from "../../../shared/http/sensitive-headers.interceptor.js";
import { SmtpSetupClaimDto } from "../dto/admin.dto.js";
import { AdminSmtpCredentialsService } from "./admin-smtp-credentials.service.js";

@Controller("smtp-setup")
@UseInterceptors(SensitiveHeadersInterceptor)
export class SmtpSetupController {
  constructor(private readonly smtpCredentialsService: AdminSmtpCredentialsService) {}

  @Get(":token")
  async getSetup(@Param("token") token: string) {
    return this.smtpCredentialsService.getSetup(token);
  }

  @Post(":token/claim")
  async claimSetup(
    @Param("token") token: string,
    @Body() dto: SmtpSetupClaimDto,
  ) {
    return this.smtpCredentialsService.claimSetup(token, dto);
  }
}
