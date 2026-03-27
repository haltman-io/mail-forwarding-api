import { Controller, Get, Post, Req, Res, UseInterceptors } from "@nestjs/common";
import type { Request, Response } from "express";

import { SensitiveHeadersInterceptor } from "../../shared/http/sensitive-headers.interceptor.js";
import {
  renderCredentialsConfirmPreviewPage,
  renderCredentialsConfirmSuccessPage,
} from "./views/credentials-confirm.view.js";
import { ApiCredentialsService } from "./services/api-credentials.service.js";

@Controller("credentials")
export class ApiCredentialsController {
  constructor(
    private readonly apiCredentialsService: ApiCredentialsService,
  ) {}

  @Post("create")
  async createCredentials(@Req() req: Request, @Res() res: Response): Promise<void> {
    const body = req.body as Record<string, unknown> | undefined;
    const query = req.query as Record<string, unknown>;

    const result = await this.apiCredentialsService.createCredentials({
      email: body?.email ?? query?.email,
      days: body?.days ?? query?.days,
      ip: req.ip,
      userAgent: String(req.headers["user-agent"] || ""),
    });

    res.status(200).json(result);
  }

  @Get("confirm")
  @UseInterceptors(SensitiveHeadersInterceptor)
  async confirmCredentialsPreview(@Req() req: Request, @Res() res: Response): Promise<void> {
    const query = req.query as Record<string, unknown>;
    const preview = await this.apiCredentialsService.previewConfirmation(query?.token);

    const previewBody = {
      ...preview.previewBody,
      confirm_via: { method: "POST", path: req.path },
    };

    if (this.wantsHtml(req)) {
      res.status(200).send(renderCredentialsConfirmPreviewPage(
        preview.token,
        req.path,
        preview.previewBody as unknown as { email: string; days: number },
      ));
      return;
    }

    res.status(200).json(previewBody);
  }

  @Post("confirm")
  @UseInterceptors(SensitiveHeadersInterceptor)
  async confirmCredentials(@Req() req: Request, @Res() res: Response): Promise<void> {
    const body = req.body as Record<string, unknown> | undefined;

    const result = await this.apiCredentialsService.confirmCredentials({
      tokenRaw: body?.token,
      ip: req.ip,
      userAgent: String(req.headers["user-agent"] || ""),
    });

    if (result.isSuccess && this.wantsHtml(req) && result.successPayload) {
      res.status(200).send(renderCredentialsConfirmSuccessPage(
        result.successPayload.email,
        result.successPayload.token,
        result.successPayload.expiresInDays,
      ));
      return;
    }

    res.status(result.status).json(result.body);
  }

  private wantsHtml(req: Request): boolean {
    return String(req.headers.accept || "").toLowerCase().includes("text/html");
  }
}
