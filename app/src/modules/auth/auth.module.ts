import { Module } from "@nestjs/common";

import { AuthController } from "./auth.controller.js";
import { AuthUsersRepository } from "./repositories/auth-users.repository.js";
import { PasswordResetRequestsRepository } from "./repositories/password-reset-requests.repository.js";
import { AuthService } from "./services/auth.service.js";
import { AuthSessionContextService } from "./services/auth-session-context.service.js";
import { PasswordService } from "./services/password.service.js";
import { PasswordResetEmailService } from "./services/password-reset-email.service.js";

@Module({
  controllers: [AuthController],
  providers: [
    AuthUsersRepository,
    PasswordResetRequestsRepository,
    AuthService,
    AuthSessionContextService,
    PasswordResetEmailService,
    PasswordService,
  ],
  exports: [AuthUsersRepository, AuthSessionContextService, PasswordService],
})
export class AuthModule {}
