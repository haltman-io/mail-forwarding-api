import { Body, Controller, Get, Post, Req, Res, UseInterceptors } from "@nestjs/common";
import type { Request, Response } from "express";

import {
  normalizeConfirmationCode,
} from "../../shared/utils/confirmation-code.js";
import { SensitiveHeadersInterceptor } from "../../shared/http/sensitive-headers.interceptor.js";
import { ConfirmBodyDto } from "./dto/confirm-body.dto.js";
import { ForwardingService } from "./services/forwarding.service.js";

@Controller("forward")
export class ForwardingController {
  constructor(
    private readonly forwardingService: ForwardingService,
  ) {}

  @Get("subscribe")
  async subscribe(@Req() req: Request, @Res() res: Response): Promise<void> {
    const query = req.query as Record<string, unknown>;
    const result = await this.forwardingService.subscribe({
      nameRaw: query?.name,
      domainRaw: query?.domain,
      addressRaw: query?.address,
      toRaw: typeof query?.to === "string" ? query.to : "",
      ipText: req.ip,
      userAgent: String(req.headers["user-agent"] || ""),
      origin: req.get("origin") || "",
      referer: req.get("referer") || req.get("referrer") || "",
    });

    res.status(200).json(result);
  }

  @Get("unsubscribe")
  async unsubscribe(@Req() req: Request, @Res() res: Response): Promise<void> {
    const query = req.query as Record<string, unknown>;
    const result = await this.forwardingService.unsubscribe({
      aliasRaw: typeof query?.alias === "string" ? query.alias : "",
      clientIp: req.ip || "",
      ipText: req.ip,
      userAgent: String(req.headers["user-agent"] || ""),
      origin: req.get("origin") || "",
      referer: req.get("referer") || req.get("referrer") || "",
    });

    res.status(200).json(result);
  }

  @Get("confirm")
  @UseInterceptors(SensitiveHeadersInterceptor)
  async confirmGet(@Req() req: Request, @Res() res: Response): Promise<void> {
    const query = req.query as Record<string, unknown>;
    const rawToken = typeof query?.token === "string" ? query.token : "";
    const token = normalizeConfirmationCode(rawToken);

    const result = await this.forwardingService.confirmAction(token);

    res.status(result.status).json(result.body);
  }

  @Post("confirm")
  @UseInterceptors(SensitiveHeadersInterceptor)
  async confirm(
    @Body() dto: ConfirmBodyDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.forwardingService.confirmAction(dto.token);

    res.status(result.status).json(result.body);
  }
}
