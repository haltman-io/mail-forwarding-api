import { Controller, Get, Post, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";

import type { AccessJwtSettings } from "../../shared/utils/access-jwt.js";
import {
  mintAccessJwt,
} from "../../shared/utils/access-jwt.js";
import {
  buildCookieOptions,
  clearAuthCookies,
  getRefreshCookie,
  setAccessCookie,
  setRefreshCookie,
  type AuthCookieSameSite,
} from "../../shared/utils/auth-cookies.js";
import {
  normalizeEmailStrict,
  normalizeUsername,
  parseIdentifier,
} from "../../shared/utils/auth-identifiers.js";
import {
  createOpaqueToken,
  isOpaqueTokenFormatValid,
  normalizeOpaqueToken,
} from "../../shared/utils/auth-secrets.js";
import {
  deriveCsrfToken,
  isCsrfTokenValid,
  readCsrfHeader,
} from "../../shared/utils/csrf.js";
import { sha256Buffer } from "../../shared/utils/crypto.js";
import { packIp16 } from "../../shared/utils/ip-pack.js";
import { AppLogger } from "../../shared/logging/app-logger.service.js";
import {
  AuthUsersRepository,
  type AuthUserRow,
} from "./repositories/auth-users.repository.js";
import { EmailVerificationTokensRepository } from "./repositories/email-verification-tokens.repository.js";
import { PasswordResetRequestsRepository } from "./repositories/password-reset-requests.repository.js";
import { AuthSessionContextService } from "./services/auth-session-context.service.js";
import {
  EmailVerificationEmailService,
} from "./services/email-verification-email.service.js";
import { MAX_PASSWORD_LEN, MIN_PASSWORD_LEN, PasswordService } from "./services/password.service.js";
import {
  PasswordResetEmailService,
} from "./services/password-reset-email.service.js";

interface AppSettings {
  envName: string;
}

interface AuthSettings extends AccessJwtSettings {
  verifyEmailTtlMinutes: number;
  passwordResetTtlMinutes: number;
  refreshTtlDays: number;
  maxActiveSessionFamilies: number;
  cookieSameSite: AuthCookieSameSite;
  csrfSecret: string;
}

function parsePassword(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length < MIN_PASSWORD_LEN || raw.length > MAX_PASSWORD_LEN) return null;
  return raw;
}

function toPublicAuthUser(row: AuthUserRow | null): Record<string, unknown> | null {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    email_verified_at: row.email_verified_at || null,
    is_active: Number(row.is_active || 0),
    is_admin: Number(row.is_admin || 0) === 1,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    last_login_at: row.last_login_at || null,
  };
}

@Controller()
export class AuthController {
  constructor(
    private readonly configService: ConfigService,
    private readonly authUsersRepository: AuthUsersRepository,
    private readonly emailVerificationTokensRepository: EmailVerificationTokensRepository,
    private readonly passwordResetRequestsRepository: PasswordResetRequestsRepository,
    private readonly authSessionContextService: AuthSessionContextService,
    private readonly emailVerificationEmailService: EmailVerificationEmailService,
    private readonly passwordResetEmailService: PasswordResetEmailService,
    private readonly passwordService: PasswordService,
    private readonly logger: AppLogger,
  ) {}

  @Post("auth/sign-up")
  async signUp(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const body = req.body as Record<string, unknown> | undefined;
      const email = normalizeEmailStrict(body?.email);
      if (!email) {
        res.status(400).json({ error: "invalid_params", field: "email" });
        return;
      }

      const username = normalizeUsername(body?.username);
      if (!username) {
        res.status(400).json({ error: "invalid_params", field: "username" });
        return;
      }

      const password = parsePassword(body?.password);
      if (!password) {
        res.status(400).json({
          error: "invalid_params",
          field: "password",
          hint: `string ${MIN_PASSWORD_LEN}..${MAX_PASSWORD_LEN} chars`,
        });
        return;
      }

      const [existingByEmail, existingByUsername] = await Promise.all([
        this.authUsersRepository.getUserByEmail(email).catch(() => null),
        this.authUsersRepository.getUserByUsername(username).catch(() => null),
      ]);

      if (existingByEmail) {
        if (!existingByEmail.email_verified_at) {
          await this.trySendVerificationEmail({
            userId: existingByEmail.id,
            email: existingByEmail.email,
            req,
          });
        }
        this.setNoStore(res);
        res.status(202).json({
          ok: true,
          action: "sign_up",
          accepted: true,
        });
        return;
      }

      if (existingByUsername) {
        this.setNoStore(res);
        res.status(202).json({
          ok: true,
          action: "sign_up",
          accepted: true,
        });
        return;
      }

      const passwordHash = await this.passwordService.hashPassword(password);
      const created = await this.authUsersRepository.createUser({
        email,
        username,
        passwordHash,
        isActive: 1,
        isAdmin: 0,
        emailVerifiedAt: null,
      });

      if (created.insertId) {
        await this.trySendVerificationEmail({ userId: created.insertId, email, req });
      }

      this.setNoStore(res);
      res.status(202).json({
        ok: true,
        action: "sign_up",
        accepted: true,
      });
    } catch (err) {
      const e = err as { code?: string };
      if (e?.code === "ER_DUP_ENTRY") {
        this.setNoStore(res);
        res.status(202).json({
          ok: true,
          action: "sign_up",
          accepted: true,
        });
        return;
      }

      this.logger.logError("auth.signUp.error", err, req);
      res.status(500).json({ error: "internal_error" });
    }
  }

  @Post("auth/verify-email")
  async verifyEmail(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const body = req.body as Record<string, unknown> | undefined;
      const token = normalizeOpaqueToken(body?.token);
      if (!token) {
        res.status(400).json({ error: "invalid_params", field: "token" });
        return;
      }
      if (!isOpaqueTokenFormatValid(token)) {
        res.status(400).json({ error: "invalid_token" });
        return;
      }

      const result = await this.emailVerificationTokensRepository.consumePendingTokenTx({
        tokenHash32: sha256Buffer(token),
      });
      if (!result.ok) {
        res.status(400).json({ error: "invalid_or_expired" });
        return;
      }

      this.setNoStore(res);
      res.status(200).json({
        ok: true,
        action: "verify_email",
        verified: true,
        user: result.user || null,
      });
    } catch (err) {
      const e = err as { code?: string };
      if (e?.code === "tx_busy") {
        res.status(503).json({ error: "temporarily_unavailable" });
        return;
      }
      this.logger.logError("auth.verifyEmail.error", err, req);
      res.status(500).json({ error: "internal_error" });
    }
  }

  @Post("auth/sign-in")
  async signIn(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const body = req.body as Record<string, unknown> | undefined;
      const identifier = parseIdentifier(body?.identifier);
      if (!identifier) {
        await this.passwordService.consumeSlowVerify(body?.password);
        res.status(400).json({ error: "invalid_params", field: "identifier" });
        return;
      }

      const password = parsePassword(body?.password);
      if (!password) {
        await this.passwordService.consumeSlowVerify(body?.password);
        res.status(400).json({
          error: "invalid_params",
          field: "password",
          hint: `string ${MIN_PASSWORD_LEN}..${MAX_PASSWORD_LEN} chars`,
        });
        return;
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
        res.status(401).json({ error: "auth_failed" });
        return;
      }

      const authSettings = this.getAuthSettings();
      const refreshToken = createOpaqueToken();
      const requestIpPacked = req.ip ? packIp16(req.ip) : null;
      const userAgent = String(req.headers["user-agent"] || "").slice(0, 255);
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

      this.setAuthCookies(res, {
        accessToken: access.token,
        refreshToken,
        refreshExpiresAt: session.refreshExpiresAt,
      });

      await this.authUsersRepository.updateLastLoginAtById(user.id);
      const freshUser = await this.authUsersRepository.getUserById(user.id);

      this.setNoStore(res);
      res.status(200).json({
        ok: true,
        action: "sign_in",
        authenticated: true,
        user: toPublicAuthUser(freshUser || user),
        session: {
          session_family_id: session.sessionFamilyId,
          access_expires_at: new Date(Number(access.claims.exp) * 1000).toISOString(),
          refresh_expires_at: session.refreshExpiresAt || null,
        },
      });
    } catch (err) {
      this.logger.logError("auth.signIn.error", err, req);
      res.status(500).json({ error: "internal_error" });
    }
  }

  @Get("auth/session")
  async getSession(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const auth = await this.authSessionContextService.resolveAccessSession(req);
      const userId = Number(auth?.user_id || 0);
      if (!Number.isInteger(userId) || userId <= 0) {
        res.status(401).json({ error: "invalid_or_expired_session" });
        return;
      }

      const user = await this.authUsersRepository.getUserById(userId);
      if (!user || Number(user.is_active || 0) !== 1) {
        res.status(401).json({ error: "invalid_or_expired_session" });
        return;
      }

      await this.authUsersRepository.touchSessionFamilyLastUsed(auth!.session_family_id);
      this.setNoStore(res);
      res.status(200).json({
        ok: true,
        authenticated: true,
        user: toPublicAuthUser(user),
        session: {
          session_family_id: auth?.session_family_id || null,
          access_expires_at: auth?.access_expires_at || null,
          refresh_expires_at: auth?.refresh_expires_at || null,
        },
      });
    } catch (err) {
      this.logger.logError("auth.session.error", err, req);
      res.status(500).json({ error: "internal_error" });
    }
  }

  @Get("auth/csrf")
  async getCsrf(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const auth = await this.authSessionContextService.resolveAccessOrRefreshSession(req);
      if (!auth) {
        res.status(401).json({ error: "invalid_or_expired_session" });
        return;
      }

      this.setNoStore(res);
      res.status(200).json({
        ok: true,
        csrf_token: deriveCsrfToken(auth.session_family_id, this.getAuthSettings().csrfSecret),
      });
    } catch (err) {
      this.logger.logError("auth.csrf.error", err, req);
      res.status(500).json({ error: "internal_error" });
    }
  }

  @Post("auth/refresh")
  async refreshSession(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const authSettings = this.getAuthSettings();
      const refreshContext = await this.authSessionContextService.resolveRefreshSession(req);
      const refreshToken = normalizeOpaqueToken(getRefreshCookie(req));

      if (!refreshContext || !refreshToken) {
        this.clearCookies(res);
        res.status(401).json({ error: "invalid_or_expired_session" });
        return;
      }

      const csrfToken = readCsrfHeader(req);
      if (!csrfToken) {
        res.status(403).json({ error: "csrf_required" });
        return;
      }
      if (
        !isCsrfTokenValid(
          refreshContext.session_family_id,
          csrfToken,
          authSettings.csrfSecret,
        )
      ) {
        res.status(403).json({ error: "invalid_csrf_token" });
        return;
      }

      const nextRefreshToken = createOpaqueToken();
      const requestIpPacked = req.ip ? packIp16(req.ip) : null;
      const userAgent = String(req.headers["user-agent"] || "").slice(0, 255);
      const rotated = await this.authUsersRepository.rotateRefreshSessionTx({
        presentedRefreshTokenHash32: sha256Buffer(refreshToken),
        nextRefreshTokenHash32: sha256Buffer(nextRefreshToken),
        requestIpPacked,
        userAgentOrNull: userAgent || null,
      });

      if (!rotated.ok) {
        this.clearCookies(res);
        res.status(401).json({ error: "invalid_or_expired_session" });
        return;
      }

      const access = mintAccessJwt(authSettings, {
        userId: Number(rotated.userId || 0),
        sessionFamilyId: String(rotated.sessionFamilyId || ""),
      });

      this.setAuthCookies(res, {
        accessToken: access.token,
        refreshToken: nextRefreshToken,
        refreshExpiresAt: rotated.refreshExpiresAt || null,
      });

      this.setNoStore(res);
      res.status(200).json({
        ok: true,
        action: "refresh",
        refreshed: true,
        session: {
          session_family_id: rotated.sessionFamilyId,
          access_expires_at: new Date(Number(access.claims.exp) * 1000).toISOString(),
          refresh_expires_at: rotated.refreshExpiresAt || null,
        },
      });
    } catch (err) {
      const e = err as { code?: string };
      if (e?.code === "tx_busy") {
        res.status(503).json({ error: "temporarily_unavailable" });
        return;
      }
      this.logger.logError("auth.refresh.error", err, req);
      res.status(500).json({ error: "internal_error" });
    }
  }

  @Post("auth/sign-out")
  async signOut(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const auth = await this.authSessionContextService.resolveAccessOrRefreshSession(req);
      if (auth) {
        const csrfToken = readCsrfHeader(req);
        if (!csrfToken) {
          res.status(403).json({ error: "csrf_required" });
          return;
        }
        if (
          !isCsrfTokenValid(auth.session_family_id, csrfToken, this.getAuthSettings().csrfSecret)
        ) {
          res.status(403).json({ error: "invalid_csrf_token" });
          return;
        }

        await this.authUsersRepository.revokeSessionFamilyById(auth.session_family_id);
      }

      this.clearCookies(res);
      this.setNoStore(res);
      res.status(200).json({
        ok: true,
        action: "sign_out",
        signed_out: true,
      });
    } catch (err) {
      this.logger.logError("auth.signOut.error", err, req);
      res.status(500).json({ error: "internal_error" });
    }
  }

  @Post("auth/sign-out-all")
  async signOutAll(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const auth = await this.authSessionContextService.resolveAccessOrRefreshSession(req);
      let revoked = 0;

      if (auth) {
        const csrfToken = readCsrfHeader(req);
        if (!csrfToken) {
          res.status(403).json({ error: "csrf_required" });
          return;
        }
        if (
          !isCsrfTokenValid(auth.session_family_id, csrfToken, this.getAuthSettings().csrfSecret)
        ) {
          res.status(403).json({ error: "invalid_csrf_token" });
          return;
        }

        revoked = await this.authUsersRepository.revokeSessionsByUserId(auth.user_id);
      }

      this.clearCookies(res);
      this.setNoStore(res);
      res.status(200).json({
        ok: true,
        action: "sign_out_all",
        signed_out_all: true,
        sessions_revoked: revoked,
      });
    } catch (err) {
      this.logger.logError("auth.signOutAll.error", err, req);
      res.status(500).json({ error: "internal_error" });
    }
  }

  @Post("auth/forgot-password")
  async forgotPassword(@Req() req: Request, @Res() res: Response): Promise<void> {
    const ttlMinutes = Number(this.getAuthSettings().passwordResetTtlMinutes || 15);

    try {
      const body = req.body as Record<string, unknown> | undefined;
      const email = normalizeEmailStrict(body?.email);
      if (!email) {
        res.status(400).json({ error: "invalid_params", field: "email" });
        return;
      }

      const user = await this.authUsersRepository.getActiveUserByEmail(email);
      if (user) {
        try {
          await this.passwordResetEmailService.sendPasswordResetEmail({
            userId: user.id,
            email: user.email,
            requestIpText: req.ip,
            userAgent: String(req.headers["user-agent"] || ""),
          });
        } catch (err) {
          this.logger.logError("auth.forgotPassword.send.error", err, req, { email });
        }
      }

      this.setNoStore(res);
      res.status(200).json({
        ok: true,
        action: "forgot_password",
        accepted: true,
        recovery: {
          ttl_minutes: ttlMinutes,
        },
      });
    } catch (err) {
      this.logger.logError("auth.forgotPassword.error", err, req);
      this.setNoStore(res);
      res.status(200).json({
        ok: true,
        action: "forgot_password",
        accepted: true,
        recovery: {
          ttl_minutes: ttlMinutes,
        },
      });
    }
  }

  @Post("auth/reset-password")
  async resetPassword(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const body = req.body as Record<string, unknown> | undefined;
      const token = normalizeOpaqueToken(body?.token);
      if (!token) {
        res.status(400).json({ error: "invalid_params", field: "token" });
        return;
      }
      if (!isOpaqueTokenFormatValid(token)) {
        res.status(400).json({ error: "invalid_token" });
        return;
      }

      const newPassword = parsePassword(body?.new_password);
      if (!newPassword) {
        res.status(400).json({
          error: "invalid_params",
          field: "new_password",
          hint: `string ${MIN_PASSWORD_LEN}..${MAX_PASSWORD_LEN} chars`,
        });
        return;
      }

      const pending = await this.passwordResetRequestsRepository.getPendingByTokenHash(
        sha256Buffer(token),
      );
      if (!pending) {
        res.status(400).json({ error: "invalid_or_expired" });
        return;
      }

      const passwordHash = await this.passwordService.hashPassword(newPassword);
      const result = await this.passwordResetRequestsRepository.consumePendingAndResetPasswordTx({
        tokenHash32: sha256Buffer(token),
        passwordHash,
      });

      if (!result.ok) {
        res.status(400).json({ error: "invalid_or_expired" });
        return;
      }

      this.clearCookies(res);
      this.setNoStore(res);
      res.status(200).json({
        ok: true,
        action: "reset_password",
        updated: true,
        reauth_required: true,
        sessions_revoked: Number(result.sessionsRevoked ?? 0),
        user: result.user || null,
      });
    } catch (err) {
      const e = err as { code?: string };
      if (e?.code === "tx_busy") {
        res.status(503).json({ error: "temporarily_unavailable" });
        return;
      }
      this.logger.logError("auth.resetPassword.error", err, req);
      res.status(500).json({ error: "internal_error" });
    }
  }

  private setNoStore(res: Response): void {
    res.set("Cache-Control", "no-store");
  }

  private clearCookies(res: Response): void {
    const appSettings = this.configService.getOrThrow<AppSettings>("app");
    const authSettings = this.getAuthSettings();
    clearAuthCookies(res, appSettings.envName, authSettings.cookieSameSite);
  }

  private setAuthCookies(
    res: Response,
    payload: {
      accessToken: string;
      refreshToken: string;
      refreshExpiresAt: Date | string | null;
    },
  ): void {
    const appSettings = this.configService.getOrThrow<AppSettings>("app");
    const authSettings = this.getAuthSettings();
    const accessCookieOptions = buildCookieOptions({
      maxAgeMs: Number(authSettings.jwtAccessTtlSeconds ?? 600) * 1000,
      envName: appSettings.envName,
      sameSite: authSettings.cookieSameSite,
    });

    const refreshExpiresAt = payload.refreshExpiresAt
      ? new Date(payload.refreshExpiresAt)
      : null;
    const refreshMaxAgeMs = refreshExpiresAt
      ? Math.max(0, refreshExpiresAt.getTime() - Date.now())
      : 0;
    const refreshCookieOptions = buildCookieOptions({
      maxAgeMs: refreshMaxAgeMs,
      envName: appSettings.envName,
      sameSite: authSettings.cookieSameSite,
    });

    setAccessCookie(res, payload.accessToken, accessCookieOptions);
    setRefreshCookie(res, payload.refreshToken, refreshCookieOptions);
  }

  private getAuthSettings(): AuthSettings {
    return this.configService.getOrThrow<AuthSettings>("auth");
  }

  private async trySendVerificationEmail(payload: {
    userId: number;
    email: string;
    req: Request;
  }): Promise<void> {
    try {
      await this.emailVerificationEmailService.sendEmailVerificationEmail({
        userId: payload.userId,
        email: payload.email,
        requestIpText: payload.req.ip,
        userAgent: String(payload.req.headers["user-agent"] || ""),
      });
    } catch (err) {
      this.logger.logError("auth.signUp.sendVerification.error", err, payload.req, {
        user_id: payload.userId,
        email: payload.email,
      });
    }
  }
}
