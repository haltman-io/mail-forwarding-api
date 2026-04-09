import { Module } from "@nestjs/common";

import { DomainsModule } from "../domains/domains.module.js";
import { AliasMetricsRepository } from "./alias-metrics.repository.js";
import { ForwardCounterController } from "./forward-counter.controller.js";
import { ForwardCounterRepository } from "./forward-counter.repository.js";
import { StatsController } from "./stats.controller.js";
import { StatsService } from "./stats.service.js";

@Module({
  imports: [DomainsModule],
  controllers: [StatsController, ForwardCounterController],
  providers: [AliasMetricsRepository, ForwardCounterRepository, StatsService],
})
export class StatsModule {}
