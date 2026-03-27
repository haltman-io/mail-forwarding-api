import { Module } from "@nestjs/common";

import { DomainsController } from "./domains.controller.js";
import { DomainRepository } from "./domain.repository.js";
import { DomainsService } from "./domains.service.js";

@Module({
  controllers: [DomainsController],
  providers: [DomainRepository, DomainsService],
  exports: [DomainRepository],
})
export class DomainsModule {}
