import { Module } from "@nestjs/common";

import { AuthController } from "./auth.controller.js";
import { AuthUsersRepository } from "./repositories/auth-users.repository.js";
import { EmailVerificationTokensRepository } from "./repositories/email-verification-tokens.repository.js";
import { PasswordResetRequestsRepository } from "./repositories/password-reset-requests.repository.js";
import { AuthSessionContextService } from "./services/auth-session-context.service.js";
import { EmailVerificationEmailService } from "./services/email-verification-email.service.js";
import { PasswordService } from "./services/password.service.js";
import { PasswordResetEmailService } from "./services/password-reset-email.service.js";

@Module({
  controllers: [AuthController],
  providers: [
    AuthUsersRepository,
    EmailVerificationTokensRepository,
    PasswordResetRequestsRepository,
    AuthSessionContextService,
    EmailVerificationEmailService,
    PasswordResetEmailService,
    PasswordService,
  ],
  exports: [AuthUsersRepository, AuthSessionContextService, PasswordService],
})
export class AuthModule {}
