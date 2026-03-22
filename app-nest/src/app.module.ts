import { MiddlewareConsumer, Module, RequestMethod } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";

import { ApiModule } from "./modules/api/api.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { BansModule } from "./modules/bans/bans.module.js";
import { CheckDnsModule } from "./modules/check-dns/check-dns.module.js";
import { DomainsModule } from "./modules/domains/domains.module.js";
import { ForwardingModule } from "./modules/forwarding/forwarding.module.js";
import { StatsModule } from "./modules/stats/stats.module.js";
import {
  apiCredentialsConfig,
  appConfig,
  authConfig,
  checkDnsConfig,
  corsConfig,
  databaseConfig,
  forwardingConfig,
  rateLimitConfig,
  redisConfig,
  smtpConfig,
  validateEnv,
} from "./shared/config/index.js";
import { DatabaseModule } from "./shared/database/database.module.js";
import { InfrastructureModule } from "./shared/infrastructure.module.js";
import { RequestContextMiddleware } from "./shared/logging/request-context.middleware.js";
import { RedisModule } from "./shared/redis/redis.module.js";
import { IpBanMiddleware } from "./shared/security/ip-ban.middleware.js";
import { RouteRateLimitMiddleware } from "./shared/security/rate-limit/route-rate-limit.middleware.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [apiCredentialsConfig, appConfig, authConfig, corsConfig, databaseConfig, checkDnsConfig, forwardingConfig, rateLimitConfig, redisConfig, smtpConfig],
      validate: validateEnv,
    }),
    InfrastructureModule,
    DatabaseModule,
    RedisModule,
    ApiModule,
    AuthModule,
    BansModule,
    DomainsModule,
    ForwardingModule,
    StatsModule,
    CheckDnsModule,
  ],
  providers: [RequestContextMiddleware, IpBanMiddleware, RouteRateLimitMiddleware],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware, IpBanMiddleware, RouteRateLimitMiddleware)
      .forRoutes({ path: "*", method: RequestMethod.ALL });
  }
}
