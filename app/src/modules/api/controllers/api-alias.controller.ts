import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import type { Request, Response } from "express";

import { parsePagination } from "../../../shared/http/pagination.utils.js";
import { PgpKeyCreateDto, PgpKeyPatchDto } from "../../../shared/pgp/pgp-key.dto.js";
import { PublicHttpException } from "../../../shared/errors/public-http.exception.js";
import { ApiKeyGuard } from "../guards/api-key.guard.js";
import { ApiLogInterceptor } from "../interceptors/api-log.interceptor.js";
import { AliasPgpService } from "../services/alias-pgp.service.js";
import { AliasService } from "../services/alias.service.js";

@Controller()
@UseGuards(ApiKeyGuard)
@UseInterceptors(ApiLogInterceptor)
export class ApiAliasController {
  constructor(
    private readonly aliasService: AliasService,
    private readonly aliasPgpService: AliasPgpService,
  ) {}

  @Get("alias/list")
  async listAliases(@Req() req: Request, @Res() res: Response): Promise<void> {
    const owner = this.requireOwner(req);
    const paging = parsePagination(req.query);
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
    const paging = parsePagination(
      req.query,
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

  @Get("alias/:alias/pgp")
  async getAliasPgp(
    @Param("alias") alias: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const owner = this.requireOwner(req);
    const result = await this.aliasPgpService.getPgp({
      ownerEmail: owner,
      alias,
    });

    res.status(200).json(result);
  }

  @Post("alias/:alias/pgp")
  async setAliasPgp(
    @Param("alias") alias: string,
    @Body() dto: PgpKeyCreateDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const owner = this.requireOwner(req);
    const result = await this.aliasPgpService.setPgp({
      ownerEmail: owner,
      alias,
      publicKey: dto.public_key,
      enabled: dto.enabled,
      hideSubject: dto.hide_subject,
    });

    res.status(200).json(result);
  }

  @Patch("alias/:alias/pgp")
  async patchAliasPgp(
    @Param("alias") alias: string,
    @Body() dto: PgpKeyPatchDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const owner = this.requireOwner(req);
    const result = await this.aliasPgpService.patchPgp({
      ownerEmail: owner,
      alias,
      publicKey: dto.public_key,
      enabled: dto.enabled,
      hideSubject: dto.hide_subject,
    });

    res.status(200).json(result);
  }

  @Delete("alias/:alias/pgp")
  async deleteAliasPgp(
    @Param("alias") alias: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const owner = this.requireOwner(req);
    const result = await this.aliasPgpService.deletePgp({
      ownerEmail: owner,
      alias,
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
