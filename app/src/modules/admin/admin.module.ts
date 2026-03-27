import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { BansModule } from "../bans/bans.module.js";
import { AdminAliasesRepository } from "./admin-aliases.repository.js";
import { AdminAliasesController } from "./admin-aliases.controller.js";
import { AdminAliasesService, AdminHandlesService } from "./admin-aliases-handles.service.js";
import { AdminApiTokensRepository } from "./admin-api-tokens.repository.js";
import { AdminApiTokensController } from "./admin-api-tokens.controller.js";
import { AdminApiTokensService, AdminBansService } from "./admin-bans-api-tokens.service.js";
import { AdminBansRepository } from "./admin-bans.repository.js";
import { AdminBansController } from "./admin-bans.controller.js";
import { AdminController } from "./admin.controller.js";
import { AdminDnsRequestsController } from "./admin-dns-requests.controller.js";
import { AdminDnsRequestsRepository } from "./admin-dns-requests.repository.js";
import { AdminDnsRequestsService } from "./admin-dns-requests.service.js";
import { AdminDomainsRepository } from "./admin-domains.repository.js";
import { AdminDomainsController } from "./admin-domains.controller.js";
import { AdminHandlesController } from "./admin-handles.controller.js";
import { AdminHandlesRepository } from "./admin-handles.repository.js";
import { AdminNotificationService } from "./admin-notification.service.js";
import { AdminSessionService, AdminDomainsService } from "./admin-session-domains.service.js";
import { AdminUsersController } from "./admin-users.controller.js";
import { AdminUsersRepository } from "./admin-users.repository.js";
import { AdminUsersService } from "./admin-users.service.js";

@Module({
  imports: [AuthModule, BansModule],
  controllers: [
    AdminController,
    AdminDnsRequestsController,
    AdminDomainsController,
    AdminAliasesController,
    AdminHandlesController,
    AdminBansController,
    AdminApiTokensController,
    AdminUsersController,
  ],
  providers: [
    AdminDomainsRepository,
    AdminDnsRequestsRepository,
    AdminAliasesRepository,
    AdminHandlesRepository,
    AdminBansRepository,
    AdminApiTokensRepository,
    AdminUsersRepository,
    AdminNotificationService,
    AdminSessionService,
    AdminDomainsService,
    AdminDnsRequestsService,
    AdminAliasesService,
    AdminHandlesService,
    AdminBansService,
    AdminApiTokensService,
    AdminUsersService,
  ],
})
export class AdminModule {}
