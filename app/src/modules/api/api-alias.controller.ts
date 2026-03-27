import { Controller, Get, Post, Req, Res, UseGuards, UseInterceptors } from "@nestjs/common";
import type { Request, Response } from "express";

import { ApiKeyGuard } from "./guards/api-key.guard.js";
import { ApiLogInterceptor } from "./interceptors/api-log.interceptor.js";
import { AliasService } from "./services/alias.service.js";
import { PublicHttpException } from "../../shared/errors/public-http.exception.js";

@Controller()
@UseGuards(ApiKeyGuard)
@UseInterceptors(ApiLogInterceptor)
export class ApiAliasController {
  constructor(
    private readonly aliasService: AliasService,
  ) {}

  @Get("alias/list")
  async listAliases(@Req() req: Request, @Res() res: Response): Promise<void> {
    const owner = this.requireOwner(req);
    const paging = AliasService.parsePagination(req.query as Record<string, unknown>);
    const result = await this.aliasService.listAliases({
      ownerEmail: owner,
      ...paging,
    });

    res.status(200).json(result);
  }

  @Get("alias/stats")
  async aliasStats(@Req() req: Request, @Res() res: Response): Promise<void> {
    const owner = this.requireOwner(req);
    const stats = await this.aliasService.getAliasStats(owner);
    res.status(200).json(stats);
  }

  @Get("activity")
  async getActivity(@Req() req: Request, @Res() res: Response): Promise<void> {
    const owner = this.requireOwner(req);
    const paging = AliasService.parsePagination(
      req.query as Record<string, unknown>,
      { defaultLimit: 50, maxLimit: 200 },
    );
    const result = await this.aliasService.getActivity({
      ownerEmail: owner,
      ...paging,
    });

    res.status(200).json(result);
  }

  @Post("alias/create")
  async createAlias(@Req() req: Request, @Res() res: Response): Promise<void> {
    const owner = this.requireOwner(req);
    const body = req.body as Record<string, unknown> | undefined;
    const query = req.query as Record<string, unknown>;
    const result = await this.aliasService.createAlias({
      ownerEmail: owner,
      aliasHandle: body?.alias_handle ?? query?.alias_handle,
      aliasDomain: body?.alias_domain ?? query?.alias_domain,
    });

    res.status(200).json(result);
  }

  @Post("alias/delete")
  async deleteAlias(@Req() req: Request, @Res() res: Response): Promise<void> {
    const owner = this.requireOwner(req);
    const body = req.body as Record<string, unknown> | undefined;
    const query = req.query as Record<string, unknown>;
    const result = await this.aliasService.deleteAlias({
      ownerEmail: owner,
      alias: body?.alias ?? query?.alias,
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
