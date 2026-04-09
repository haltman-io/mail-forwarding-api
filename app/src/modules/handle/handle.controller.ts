import { Body, Controller, Get, Post, Req, Res, UseInterceptors } from "@nestjs/common";
import type { Request, Response } from "express";

import { SensitiveHeadersInterceptor } from "../../shared/http/sensitive-headers.interceptor.js";
import { ConfirmBodyDto } from "../forwarding/dto/confirm-body.dto.js";
import { HandleService } from "./services/handle.service.js";

@Controller("handle")
export class HandleController {
  constructor(
    private readonly handleService: HandleService,
  ) {}

  @Get("subscribe")
  async subscribe(@Req() req: Request, @Res() res: Response): Promise<void> {
    const query = req.query as Record<string, unknown>;
    const result = await this.handleService.subscribe({
      handleRaw: query?.handle,
      toRaw: typeof query?.to === "string" ? query.to : "",
      ipText: req.ip,
      userAgent: String(req.headers["user-agent"] || ""),
      origin: req.get("origin") || "",
      referer: req.get("referer") || req.get("referrer") || "",
    });

    res.status(result.status).json(result.body);
  }

  @Get("unsubscribe")
  async unsubscribe(@Req() req: Request, @Res() res: Response): Promise<void> {
    const query = req.query as Record<string, unknown>;
    const result = await this.handleService.unsubscribe({
      handleRaw: query?.handle,
      ipText: req.ip,
      userAgent: String(req.headers["user-agent"] || ""),
      origin: req.get("origin") || "",
      referer: req.get("referer") || req.get("referrer") || "",
    });

    res.status(result.status).json(result.body);
  }

  @Get("domain/disable")
  async domainDisable(@Req() req: Request, @Res() res: Response): Promise<void> {
    const query = req.query as Record<string, unknown>;
    const result = await this.handleService.domainDisable({
      handleRaw: query?.handle,
      domainRaw: query?.domain,
      ipText: req.ip,
      userAgent: String(req.headers["user-agent"] || ""),
      origin: req.get("origin") || "",
      referer: req.get("referer") || req.get("referrer") || "",
    });

    res.status(result.status).json(result.body);
  }

  @Get("domain/enable")
  async domainEnable(@Req() req: Request, @Res() res: Response): Promise<void> {
    const query = req.query as Record<string, unknown>;
    const result = await this.handleService.domainEnable({
      handleRaw: query?.handle,
      domainRaw: query?.domain,
      ipText: req.ip,
      userAgent: String(req.headers["user-agent"] || ""),
      origin: req.get("origin") || "",
      referer: req.get("referer") || req.get("referrer") || "",
    });

    res.status(result.status).json(result.body);
  }

  @Get("confirm")
  @UseInterceptors(SensitiveHeadersInterceptor)
  async confirmGet(@Req() req: Request, @Res() res: Response): Promise<void> {
    const query = req.query as Record<string, unknown>;
    const result = await this.handleService.confirmAction(query?.token);
    res.status(result.status).json(result.body);
  }

  @Post("confirm")
  @UseInterceptors(SensitiveHeadersInterceptor)
  async confirmPost(
    @Body() dto: ConfirmBodyDto,
    @Req() _req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.handleService.confirmAction(dto.token);
    res.status(result.status).json(result.body);
  }

  @Get("unsubscribe/confirm")
  @UseInterceptors(SensitiveHeadersInterceptor)
  async unsubscribeConfirmGet(@Req() req: Request, @Res() res: Response): Promise<void> {
    const query = req.query as Record<string, unknown>;
    const result = await this.handleService.confirmAction(query?.token);
    res.status(result.status).json(result.body);
  }

  @Post("unsubscribe/confirm")
  @UseInterceptors(SensitiveHeadersInterceptor)
  async unsubscribeConfirmPost(
    @Body() dto: ConfirmBodyDto,
    @Req() _req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.handleService.confirmAction(dto.token);
    res.status(result.status).json(result.body);
  }

  @Get("domain/disable/confirm")
  @UseInterceptors(SensitiveHeadersInterceptor)
  async domainDisableConfirmGet(@Req() req: Request, @Res() res: Response): Promise<void> {
    const query = req.query as Record<string, unknown>;
    const result = await this.handleService.confirmAction(query?.token);
    res.status(result.status).json(result.body);
  }

  @Get("domain/enable/confirm")
  @UseInterceptors(SensitiveHeadersInterceptor)
  async domainEnableConfirmGet(@Req() req: Request, @Res() res: Response): Promise<void> {
    const query = req.query as Record<string, unknown>;
    const result = await this.handleService.confirmAction(query?.token);
    res.status(result.status).json(result.body);
  }
}
