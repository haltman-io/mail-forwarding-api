import { Module } from "@nestjs/common";

import { AliasRepositoryModule } from "../api/alias-repository.module.js";
import { BansModule } from "../bans/bans.module.js";
import { DomainsModule } from "../domains/domains.module.js";
import { ForwardingController } from "./forwarding.controller.js";
import { EmailConfirmationsRepository } from "./repositories/email-confirmations.repository.js";
import { EmailConfirmationService } from "./services/email-confirmation.service.js";
import { ForwardingService } from "./services/forwarding.service.js";

@Module({
  imports: [BansModule, DomainsModule, AliasRepositoryModule],
  controllers: [ForwardingController],
  providers: [EmailConfirmationsRepository, EmailConfirmationService, ForwardingService],
})
export class ForwardingModule {}
