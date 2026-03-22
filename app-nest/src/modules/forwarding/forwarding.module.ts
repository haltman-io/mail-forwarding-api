import { Module } from "@nestjs/common";

import { BansModule } from "../bans/bans.module.js";
import { DomainsModule } from "../domains/domains.module.js";
import { AliasRepository } from "../api/repositories/alias.repository.js";
import { ForwardingController } from "./forwarding.controller.js";
import { EmailConfirmationsRepository } from "./repositories/email-confirmations.repository.js";
import { EmailConfirmationService } from "./services/email-confirmation.service.js";

@Module({
  imports: [BansModule, DomainsModule],
  controllers: [ForwardingController],
  providers: [
    EmailConfirmationsRepository,
    EmailConfirmationService,
    AliasRepository,
  ],
})
export class ForwardingModule {}
