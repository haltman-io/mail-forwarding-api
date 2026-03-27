import { Body, Controller, Get, Post, Req, Res, UseInterceptors } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";

import {
  buildCookieOptions,
  clearAuthCookies,
  getRefreshCookie,
  setAccessCookie,
  setRefreshCookie,
} from "../../shared/utils/auth-cookies.js";
import { NoCacheInterceptor } from "../../shared/http/no-cache.interceptor.js";
import { readCsrfHeader } from "../../shared/utils/csrf.js";
import type { AppSettings, AuthSettings } from "./auth.types.js";
import { SignInDto } from "./dto/sign-in.dto.js";
import { ForgotPasswordDto } from "./dto/forgot-password.dto.js";
import { ResetPasswordDto } from "./dto/reset-password.dto.js";
import { AuthService } from "./services/auth.service.js";

@Controller("auth")
@UseInterceptors(NoCacheInterceptor)
export class AuthController {
  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
  ) {}

  @Post("sign-in")
  async signIn(
    @Body() dto: SignInDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.authService.signIn({
      identifier: dto.identifier,
      password: dto.password,
      ip: req.ip,
      userAgent: String(req.headers["user-agent"] || ""),
    });

    this.setAuthCookies(res, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      refreshExpiresAt: result.refreshExpiresAt,
    });

    res.status(200).json({
      ok: true,
      action: "sign_in",
      authenticated: true,
      user: result.user,
      session: {
        session_family_id: result.sessionFamilyId,
        access_expires_at: result.accessExpiresAt,
        refresh_expires_at: result.refreshExpiresAt || null,
      },
    });
  }

  @Get("session")
  async getSession(@Req() req: Request, @Res() res: Response): Promise<void> {
    const result = await this.authService.getSession(req);

    res.status(200).json({
      ok: true,
      authenticated: true,
      user: result.user,
      session: result.session,
    });
  }

  @Get("csrf")
  async getCsrf(@Req() req: Request, @Res() res: Response): Promise<void> {
    const result = await this.authService.getCsrfToken(req);

    res.status(200).json(result);
  }

  @Post("refresh")
  async refreshSession(@Req() req: Request, @Res() res: Response): Promise<void> {
    const result = await this.authService.refreshSession({
      req,
      refreshTokenRaw: getRefreshCookie(req),
      csrfToken: readCsrfHeader(req),
      ip: req.ip,
      userAgent: String(req.headers["user-agent"] || ""),
    });

    this.setAuthCookies(res, {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      refreshExpiresAt: result.refreshExpiresAt,
    });

    res.status(200).json({
      ok: true,
      action: "refresh",
      refreshed: true,
      session: {
        session_family_id: result.sessionFamilyId,
        access_expires_at: result.accessExpiresAt,
        refresh_expires_at: result.refreshExpiresAt || null,
      },
    });
  }

  @Post("sign-out")
  async signOut(@Req() req: Request, @Res() res: Response): Promise<void> {
    await this.authService.signOut({
      req,
      csrfToken: readCsrfHeader(req),
    });

    this.clearCookies(res);
    res.status(200).json({
      ok: true,
      action: "sign_out",
      signed_out: true,
    });
  }

  @Post("sign-out-all")
  async signOutAll(@Req() req: Request, @Res() res: Response): Promise<void> {
    const result = await this.authService.signOutAll({
      req,
      csrfToken: readCsrfHeader(req),
    });

    this.clearCookies(res);
    res.status(200).json({
      ok: true,
      action: "sign_out_all",
      signed_out_all: true,
      sessions_revoked: result.sessionsRevoked,
    });
  }

  @Post("forgot-password")
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.authService.forgotPassword({
      email: dto.email,
      ipText: req.ip,
      userAgent: String(req.headers["user-agent"] || ""),
    });

    res.status(200).json({
      ok: true,
      action: "forgot_password",
      accepted: true,
      recovery: { ttl_minutes: result.ttlMinutes },
    });
  }

  @Post("reset-password")
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.authService.resetPassword({
      token: dto.token,
      newPassword: dto.new_password,
    });

    this.clearCookies(res);
    res.status(200).json(result);
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
      ? new Date(String(payload.refreshExpiresAt))
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
}
