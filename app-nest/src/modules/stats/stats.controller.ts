import { Controller, Get, Res } from "@nestjs/common";
import type { Response } from "express";

import { StatsService } from "./stats.service.js";

@Controller()
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get("stats")
  async getStats(@Res() response: Response): Promise<void> {
    const result = await this.statsService.getStats();

    if (!result.fromCache) {
      response.set("Cache-Control", "public, max-age=60");
    }

    response.json(result.data);
  }
}
