import { Controller, Get, Req, Res, UseInterceptors } from "@nestjs/common";
import type { Response } from "express";

import { SensitiveHeadersInterceptor } from "../../shared/http/sensitive-headers.interceptor.js";
import type { Request } from "express";
import { AdminSessionService } from "./admin-session-domains.service.js";

@Controller("admin")
@UseInterceptors(SensitiveHeadersInterceptor)
export class AdminController {
  constructor(private readonly adminSessionService: AdminSessionService) {}

  @Get("me")
  async getMe(@Req() request: Request, @Res() response: Response): Promise<void> {
    const result = await this.adminSessionService.getAdminMe(request.admin_auth!);
    response.status(200).json(result);
  }

  @Get("protected")
  async getProtected(@Res() response: Response): Promise<void> {
    response.status(200).json({
      message: "This user is an administrator",
    });
  }
}
