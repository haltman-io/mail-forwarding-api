import { Controller, Get, Req, UseInterceptors } from "@nestjs/common";

import { SensitiveHeadersInterceptor } from "../../shared/http/sensitive-headers.interceptor.js";
import type { Request } from "express";
import { AdminSessionService } from "./session/admin-session.service.js";

@Controller("admin")
@UseInterceptors(SensitiveHeadersInterceptor)
export class AdminController {
  constructor(private readonly adminSessionService: AdminSessionService) {}

  @Get("me")
  async getMe(@Req() request: Request) {
    return this.adminSessionService.getAdminMe(request.admin_auth!);
  }

  @Get("protected")
  async getProtected() {
    return {
      message: "This user is an administrator",
    };
  }
}
