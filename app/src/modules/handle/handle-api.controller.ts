import { Controller, Post, Req, Res, UseGuards, UseInterceptors } from "@nestjs/common";
import type { Request, Response } from "express";

import { PublicHttpException } from "../../shared/errors/public-http.exception.js";
import { ApiKeyGuard } from "../api/guards/api-key.guard.js";
import { ApiLogInterceptor } from "../api/interceptors/api-log.interceptor.js";
import { HandleApiService } from "./services/handle-api.service.js";

@Controller("handle")
@UseGuards(ApiKeyGuard)
@UseInterceptors(ApiLogInterceptor)
export class HandleApiController {
  constructor(
    private readonly handleApiService: HandleApiService,
  ) {}

  @Post("create")
  async createHandle(@Req() req: Request, @Res() res: Response): Promise<void> {
    const owner = this.requireOwner(req);
    const body = req.body as Record<string, unknown> | undefined;
    const result = await this.handleApiService.createHandle({
      ownerEmail: owner,
      handle: body?.handle,
    });

    res.status(200).json(result);
  }

  @Post("delete")
  async deleteHandle(@Req() req: Request, @Res() res: Response): Promise<void> {
    const owner = this.requireOwner(req);
    const body = req.body as Record<string, unknown> | undefined;
    const result = await this.handleApiService.deleteHandle({
      ownerEmail: owner,
      handle: body?.handle,
    });

    res.status(200).json(result);
  }

  @Post("domain/disable")
  async disableDomain(@Req() req: Request, @Res() res: Response): Promise<void> {
    const owner = this.requireOwner(req);
    const body = req.body as Record<string, unknown> | undefined;
    const result = await this.handleApiService.disableDomain({
      ownerEmail: owner,
      handle: body?.handle,
      domain: body?.domain,
    });

    res.status(200).json(result);
  }

  @Post("domain/enable")
  async enableDomain(@Req() req: Request, @Res() res: Response): Promise<void> {
    const owner = this.requireOwner(req);
    const body = req.body as Record<string, unknown> | undefined;
    const result = await this.handleApiService.enableDomain({
      ownerEmail: owner,
      handle: body?.handle,
      domain: body?.domain,
    });

    res.status(200).json(result);
  }

  private requireOwner(req: Request): string {
    const owner = req.api_token?.owner_email;
    if (!owner) {
      throw new PublicHttpException(401, { error: "missing_api_key" });
    }
    return owner;
  }
}
