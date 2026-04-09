import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { BansModule } from "../bans/bans.module.js";
import { AdminAliasesRepository } from "./aliases/admin-aliases.repository.js";
import { AdminAliasesController } from "./aliases/admin-aliases.controller.js";
import { AdminAliasesService } from "./aliases/admin-aliases.service.js";
import { AdminHandlesService } from "./handles/admin-handles.service.js";
import { AdminApiTokensRepository } from "./api-tokens/admin-api-tokens.repository.js";
import { AdminApiTokensController } from "./api-tokens/admin-api-tokens.controller.js";
import { AdminApiTokensService } from "./api-tokens/admin-api-tokens.service.js";
import { AdminBansService } from "./bans/admin-bans.service.js";
import { AdminBansRepository } from "./bans/admin-bans.repository.js";
import { AdminBansController } from "./bans/admin-bans.controller.js";
import { AdminController } from "./admin.controller.js";
import { AdminDnsRequestsController } from "./dns-requests/admin-dns-requests.controller.js";
import { AdminDnsRequestsRepository } from "./dns-requests/admin-dns-requests.repository.js";
import { AdminDnsRequestsService } from "./dns-requests/admin-dns-requests.service.js";
import { AdminDomainsRepository } from "./domains/admin-domains.repository.js";
import { AdminDomainsController } from "./domains/admin-domains.controller.js";
import { AdminHandlesController } from "./handles/admin-handles.controller.js";
import { AdminHandlesRepository } from "./handles/admin-handles.repository.js";
import { AdminCreationNotificationService } from "./utils/admin-creation-notification.service.js";
import { AdminNotificationService } from "./users/admin-notification.service.js";
import { AdminDomainsService } from "./domains/admin-domains.service.js";
import { AdminSessionService } from "./session/admin-session.service.js";
import { AdminUsersController } from "./users/admin-users.controller.js";
import { AdminUsersRepository } from "./users/admin-users.repository.js";
import { AdminUsersService } from "./users/admin-users.service.js";

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
    AdminCreationNotificationService,
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
