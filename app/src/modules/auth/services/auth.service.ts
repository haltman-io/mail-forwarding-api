import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { AuthSettings, PublicAuthUser } from "../auth.types.js";
import { mintAccessJwt } from "../../../shared/utils/access-jwt.js";
import {
  normalizeEmailStrict,
  parseIdentifier,
} from "../../../shared/utils/auth-identifiers.js";
import {
  createOpaqueToken,
} from "../../../shared/utils/auth-secrets.js";
import {
  isConfirmationCodeValid,
  normalizeConfirmationCode,
} from "../../../shared/utils/confirmation-code.js";
import {
  deriveCsrfToken,
  isCsrfTokenValid,
} from "../../../shared/utils/csrf.js";
import { sha256Buffer } from "../../../shared/utils/crypto.js";
import { packIp16 } from "../../../shared/utils/ip-pack.js";
import { PublicHttpException } from "../../../shared/errors/public-http.exception.js";
import { AppLogger } from "../../../shared/logging/app-logger.service.js";
import {
  AuthUsersRepository,
  type AuthUserRow,
} from "../repositories/auth-users.repository.js";
import { PasswordResetRequestsRepository } from "../repositories/password-reset-requests.repository.js";
import { AuthSessionContextService } from "./auth-session-context.service.js";
import { PasswordResetEmailService } from "./password-reset-email.service.js";
import { MAX_PASSWORD_LEN, MIN_PASSWORD_LEN, PasswordService } from "./password.service.js";

import type { Request } from "express";

@Injectable()
export class AuthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly authUsersRepository: AuthUsersRepository,
    private readonly passwordResetRequestsRepository: PasswordResetRequestsRepository,
    private readonly authSessionContextService: AuthSessionContextService,
    private readonly passwordResetEmailService: PasswordResetEmailService,
    private readonly passwordService: PasswordService,
    private readonly logger: AppLogger,
  ) {}

  async signIn(params: {
    identifier: unknown;
    password: unknown;
    ip: string | undefined;
    userAgent: string;
  }): Promise<{
    user: PublicAuthUser;
    accessToken: string;
    accessExpiresAt: string;
    refreshToken: string;
    sessionFamilyId: string;
    refreshExpiresAt: Date | string | null;
  }> {
    const identifier = parseIdentifier(params.identifier);
    if (!identifier) {
      await this.passwordService.consumeSlowVerify(params.password);
      throw new PublicHttpException(400, { error: "invalid_params", field: "identifier" });
    }

    const password = this.parsePassword(params.password);
    if (!password) {
      await this.passwordService.consumeSlowVerify(params.password);
      throw new PublicHttpException(400, {
        error: "invalid_params",
        field: "password",
        hint: `string ${MIN_PASSWORD_LEN}..${MAX_PASSWORD_LEN} chars`,
      });
    }

    const user = await this.authUsersRepository.getActiveUserByIdentifier(identifier);
    let isPasswordValid = false;

    if (!user) {
      await this.passwordService.consumeSlowVerify(password);
    } else {
      try {
        isPasswordValid = await this.passwordService.verifyPassword(
          String(user.password_hash || ""),
          password,
        );
      } catch {
        isPasswordValid = false;
      }
    }

    if (!user || !isPasswordValid || !user.email_verified_at) {
      throw new PublicHttpException(401, { error: "auth_failed" });
    }

    const authSettings = this.getAuthSettings();
    const refreshToken = createOpaqueToken();
    const requestIpPacked = params.ip ? packIp16(params.ip) : null;
    const userAgent = params.userAgent.slice(0, 255);
    const session = await this.authUsersRepository.createSessionFamilyTx({
      userId: user.id,
      refreshTokenHash32: sha256Buffer(refreshToken),
      refreshTtlDays: authSettings.refreshTtlDays,
      requestIpPacked,
      userAgentOrNull: userAgent || null,
      maxActiveFamilies: authSettings.maxActiveSessionFamilies,
    });

    if (!session.ok || !session.sessionFamilyId) {
      throw new Error("auth_session_create_failed");
    }

    const access = mintAccessJwt(authSettings, {
      userId: user.id,
      sessionFamilyId: session.sessionFamilyId,
    });

    await this.authUsersRepository.updateLastLoginAtById(user.id);
    const freshUser = await this.authUsersRepository.getUserById(user.id);

    return {
      user: this.toPublicAuthUser(freshUser || user)!,
      accessToken: access.token,
      accessExpiresAt: new Date(Number(access.claims.exp) * 1000).toISOString(),
      refreshToken,
      sessionFamilyId: session.sessionFamilyId,
      refreshExpiresAt: session.refreshExpiresAt,
    };
  }

  async getSession(req: Request): Promise<{
    user: PublicAuthUser;
    session: {
      session_family_id: string | null;
      access_expires_at: string | null;
      refresh_expires_at: Date | string | null;
    };
  }> {
    const auth = await this.authSessionContextService.resolveAccessSession(req);
    const userId = Number(auth?.user_id || 0);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new PublicHttpException(401, { error: "invalid_or_expired_session" });
    }

    const user = await this.authUsersRepository.getUserById(userId);
    if (!user || Number(user.is_active || 0) !== 1) {
      throw new PublicHttpException(401, { error: "invalid_or_expired_session" });
    }

    await this.authUsersRepository.touchSessionFamilyLastUsed(auth!.session_family_id);

    return {
      user: this.toPublicAuthUser(user)!,
      session: {
        session_family_id: auth?.session_family_id || null,
        access_expires_at: auth?.access_expires_at || null,
        refresh_expires_at: auth?.refresh_expires_at || null,
      },
    };
  }

  async getCsrfToken(req: Request): Promise<{ ok: true; csrf_token: string }> {
    const auth = await this.authSessionContextService.resolveAccessOrRefreshSession(req);
    if (!auth) {
      throw new PublicHttpException(401, { error: "invalid_or_expired_session" });
    }

    return {
      ok: true,
      csrf_token: deriveCsrfToken(auth.session_family_id, this.getAuthSettings().csrfSecret),
    };
  }

  async refreshSession(params: {
    req: Request;
    refreshTokenRaw: string | undefined;
    csrfToken: string | undefined;
    ip: string | undefined;
    userAgent: string;
  }): Promise<{
    accessToken: string;
    accessExpiresAt: string;
    refreshToken: string;
    sessionFamilyId: string;
    refreshExpiresAt: Date | string | null;
  }> {
    const authSettings = this.getAuthSettings();
    const refreshContext = await this.authSessionContextService.resolveRefreshSession(params.req);
    const refreshToken = String(params.refreshTokenRaw || "").trim();

    if (!refreshContext || !refreshToken) {
      throw new PublicHttpException(401, { error: "invalid_or_expired_session" });
    }

    this.validateCsrf(refreshContext.session_family_id, params.csrfToken, authSettings);

    const nextRefreshToken = createOpaqueToken();
    const requestIpPacked = params.ip ? packIp16(params.ip) : null;
    const userAgent = params.userAgent.slice(0, 255);
    const rotated = await this.authUsersRepository.rotateRefreshSessionTx({
      presentedRefreshTokenHash32: sha256Buffer(refreshToken),
      nextRefreshTokenHash32: sha256Buffer(nextRefreshToken),
      requestIpPacked,
      userAgentOrNull: userAgent || null,
    });

    if (!rotated.ok) {
      throw new PublicHttpException(401, { error: "invalid_or_expired_session" });
    }

    const access = mintAccessJwt(authSettings, {
      userId: Number(rotated.userId || 0),
      sessionFamilyId: String(rotated.sessionFamilyId || ""),
    });

    return {
      accessToken: access.token,
      accessExpiresAt: new Date(Number(access.claims.exp) * 1000).toISOString(),
      refreshToken: nextRefreshToken,
      sessionFamilyId: String(rotated.sessionFamilyId || ""),
      refreshExpiresAt: rotated.refreshExpiresAt || null,
    };
  }

  async signOut(params: {
    req: Request;
    csrfToken: string | undefined;
  }): Promise<void> {
    const auth = await this.authSessionContextService.resolveAccessOrRefreshSession(params.req);
    if (auth) {
      this.validateCsrf(auth.session_family_id, params.csrfToken, this.getAuthSettings());
      await this.authUsersRepository.revokeSessionFamilyById(auth.session_family_id);
    }
  }

  async signOutAll(params: {
    req: Request;
    csrfToken: string | undefined;
  }): Promise<{ sessionsRevoked: number }> {
    const auth = await this.authSessionContextService.resolveAccessOrRefreshSession(params.req);
    let revoked = 0;

    if (auth) {
      this.validateCsrf(auth.session_family_id, params.csrfToken, this.getAuthSettings());
      revoked = await this.authUsersRepository.revokeSessionsByUserId(auth.user_id);
    }

    return { sessionsRevoked: revoked };
  }

  async forgotPassword(params: {
    email: unknown;
    ipText: string | undefined;
    userAgent: string;
  }): Promise<{ ttlMinutes: number }> {
    const ttlMinutes = Number(this.getAuthSettings().passwordResetTtlMinutes || 15);
    const email = normalizeEmailStrict(params.email);
    if (!email) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "email" });
    }

    const user = await this.authUsersRepository.getActiveUserByEmail(email);
    if (user) {
      try {
        await this.passwordResetEmailService.sendPasswordResetEmail({
          userId: user.id,
          email: user.email,
          requestIpText: params.ipText,
          userAgent: params.userAgent,
        });
      } catch (err) {
        this.logger.logError("auth.forgotPassword.send.error", err, undefined, { email });
      }
    }

    return { ttlMinutes };
  }

  async resetPassword(params: { token: unknown; newPassword: unknown }): Promise<{
    ok: true;
    action: "reset_password";
    updated: true;
    reauth_required: true;
    sessions_revoked: number;
    user: Record<string, unknown> | null;
  }> {
    const token = normalizeConfirmationCode(params.token);
    if (!token) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "token" });
    }
    if (!isConfirmationCodeValid(token)) {
      throw new PublicHttpException(400, { error: "invalid_token" });
    }

    const newPassword = this.parsePassword(params.newPassword);
    if (!newPassword) {
      throw new PublicHttpException(400, {
        error: "invalid_params",
        field: "new_password",
        hint: `string ${MIN_PASSWORD_LEN}..${MAX_PASSWORD_LEN} chars`,
      });
    }

    const pending = await this.passwordResetRequestsRepository.getPendingByTokenHash(
      sha256Buffer(token),
    );
    if (!pending) {
      throw new PublicHttpException(400, { error: "invalid_or_expired" });
    }

    const passwordHash = await this.passwordService.hashPassword(newPassword);
    const result = await this.passwordResetRequestsRepository.consumePendingAndResetPasswordTx({
      tokenHash32: sha256Buffer(token),
      passwordHash,
    });

    if (!result.ok) {
      throw new PublicHttpException(400, { error: "invalid_or_expired" });
    }

    return {
      ok: true,
      action: "reset_password",
      updated: true,
      reauth_required: true,
      sessions_revoked: Number(result.sessionsRevoked ?? 0),
      user: result.user || null,
    };
  }

  private validateCsrf(
    sessionFamilyId: string,
    csrfToken: string | undefined,
    authSettings: AuthSettings,
  ): void {
    if (!csrfToken) {
      throw new PublicHttpException(403, { error: "csrf_required" });
    }
    if (!isCsrfTokenValid(sessionFamilyId, csrfToken, authSettings.csrfSecret)) {
      throw new PublicHttpException(403, { error: "invalid_csrf_token" });
    }
  }

  private parsePassword(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    if (raw.length < MIN_PASSWORD_LEN || raw.length > MAX_PASSWORD_LEN) return null;
    return raw;
  }

  toPublicAuthUser(row: AuthUserRow | null): PublicAuthUser | null {
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      email_verified_at: row.email_verified_at ? String(row.email_verified_at) : null,
      is_active: Number(row.is_active || 0),
      is_admin: Number(row.is_admin || 0) === 1,
      created_at: row.created_at ? String(row.created_at) : null,
      updated_at: row.updated_at ? String(row.updated_at) : null,
      last_login_at: row.last_login_at ? String(row.last_login_at) : null,
    };
  }

  private getAuthSettings(): AuthSettings {
    return this.configService.getOrThrow<AuthSettings>("auth");
  }
}
