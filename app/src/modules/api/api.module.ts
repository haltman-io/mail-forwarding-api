import { Module } from "@nestjs/common";

import { BansModule } from "../bans/bans.module.js";
import { DomainsModule } from "../domains/domains.module.js";
import { ApiAliasController } from "./api-alias.controller.js";
import { ApiCredentialsController } from "./api-credentials.controller.js";
import { AliasRepositoryModule } from "./alias-repository.module.js";
import { ApiKeyGuard } from "./guards/api-key.guard.js";
import { ApiLogInterceptor } from "./interceptors/api-log.interceptor.js";
import { ActivityRepository } from "./repositories/activity.repository.js";
import { ApiLogsRepository } from "./repositories/api-logs.repository.js";
import { ApiTokenRequestsRepository } from "./repositories/api-token-requests.repository.js";
import { ApiTokensRepository } from "./repositories/api-tokens.repository.js";
import { AliasService } from "./services/alias.service.js";
import { ApiCredentialsEmailService } from "./services/api-credentials-email.service.js";
import { ApiCredentialsService } from "./services/api-credentials.service.js";

@Module({
  imports: [BansModule, DomainsModule, AliasRepositoryModule],
  controllers: [ApiCredentialsController, ApiAliasController],
  providers: [
    ApiTokensRepository,
    ApiTokenRequestsRepository,
    ApiLogsRepository,
    ActivityRepository,
    ApiKeyGuard,
    ApiLogInterceptor,
    AliasService,
    ApiCredentialsEmailService,
    ApiCredentialsService,
  ],
})
export class ApiModule {}
