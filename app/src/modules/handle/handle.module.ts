import { Module } from "@nestjs/common";

import { AliasRepositoryModule } from "../api/alias-repository.module.js";
import { ApiKeyGuard } from "../api/guards/api-key.guard.js";
import { ApiLogInterceptor } from "../api/interceptors/api-log.interceptor.js";
import { ApiLogsRepository } from "../api/repositories/api-logs.repository.js";
import { ApiTokensRepository } from "../api/repositories/api-tokens.repository.js";
import { BansModule } from "../bans/bans.module.js";
import { DomainsModule } from "../domains/domains.module.js";
import { ForwardingModule } from "../forwarding/forwarding.module.js";
import { HandleApiController } from "./handle-api.controller.js";
import { HandleController } from "./handle.controller.js";
import { HandleDisabledDomainRepository } from "./repositories/handle-disabled-domain.repository.js";
import { HandleRepository } from "./repositories/handle.repository.js";
import { HandleApiService } from "./services/handle-api.service.js";
import { HandleService } from "./services/handle.service.js";

@Module({
  imports: [
    BansModule,
    DomainsModule,
    AliasRepositoryModule,
    ForwardingModule,
  ],
  controllers: [HandleController, HandleApiController],
  providers: [
    HandleRepository,
    HandleDisabledDomainRepository,
    HandleService,
    HandleApiService,
    ApiKeyGuard,
    ApiTokensRepository,
    ApiLogInterceptor,
    ApiLogsRepository,
  ],
})
export class HandleModule {}
