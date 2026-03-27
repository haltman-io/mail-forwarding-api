import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";

import { DomainsService } from "./domains.service.js";

@Controller(["domains", "api/domains"])
export class DomainsController {
  constructor(private readonly domainsService: DomainsService) {}

  @Get()
  async getDomains(@Res() response: Response): Promise<void> {
    const result = await this.domainsService.getDomains();

    if (!result.fromCache) {
      response.set("Cache-Control", "public, max-age=10");
    }

    response.json(result.data);
  }
}
