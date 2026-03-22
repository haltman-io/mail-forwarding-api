import { Controller, Get, Param, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";

import {
  INVALID_TARGET_ERROR,
  normalizeDomainTarget,
} from "../../shared/validation/domain-target.js";
import { CheckDnsService, type RelayResult } from "./check-dns.service.js";

const UNSUPPORTED_MEDIA_TYPE = { error: "unsupported_media_type" };

@Controller()
export class CheckDnsController {
  constructor(private readonly checkDnsService: CheckDnsService) {}

  @Post("request/ui")
  async requestUi(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.requireJsonBody(req, res)) return;

    const body = req.body as { target?: unknown } | undefined;
    const target = this.normalizeTargetOrRespond(res, body?.target);
    if (!target) return;

    const result = await this.checkDnsService.requestUi(req, target);
    this.sendUpstreamResponse(res, result);
  }

  @Post("request/email")
  async requestEmail(@Req() req: Request, @Res() res: Response): Promise<void> {
    if (!this.requireJsonBody(req, res)) return;

    const body = req.body as { target?: unknown } | undefined;
    const target = this.normalizeTargetOrRespond(res, body?.target);
    if (!target) return;

    const result = await this.checkDnsService.requestEmail(req, target);
    this.sendUpstreamResponse(res, result);
  }

  @Get("api/checkdns/:target")
  async checkDnsStatus(
    @Req() req: Request,
    @Res() res: Response,
    @Param("target") rawTarget: string
  ): Promise<void> {
    const target = this.normalizeTargetOrRespond(res, rawTarget);
    if (!target) return;

    const result = await this.checkDnsService.checkDns(req, target);
    this.sendUpstreamResponse(res, result);
  }

  private requireJsonBody(req: Request, res: Response): boolean {
    if (!req.is("application/json")) {
      res.status(415).json(UNSUPPORTED_MEDIA_TYPE);
      return false;
    }

    return true;
  }

  private normalizeTargetOrRespond(res: Response, raw: unknown): string | null {
    const normalized = normalizeDomainTarget(raw);
    if (!normalized.ok) {
      res.status(400).json({ error: normalized.error || INVALID_TARGET_ERROR });
      return null;
    }

    return normalized.value;
  }

  private sendUpstreamResponse(res: Response, result: RelayResult): void {
    if (result.payload === undefined) {
      res.status(result.status).end();
      return;
    }

    if (Buffer.isBuffer(result.payload)) {
      res.status(result.status).send(result.payload);
      return;
    }

    if (typeof result.payload === "string") {
      res.status(result.status).send(result.payload);
      return;
    }

    res.status(result.status).json(result.payload);
  }
}
