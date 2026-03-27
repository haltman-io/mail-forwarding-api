import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";

import {
  verifyAccessJwt,
  type AccessJwtClaims,
  type AccessJwtSettings,
} from "../../../shared/utils/access-jwt.js";
import {
  getAccessCookie,
  getRefreshCookie,
} from "../../../shared/utils/auth-cookies.js";
import {
  normalizeOpaqueToken,
} from "../../../shared/utils/auth-secrets.js";
import { sha256Buffer } from "../../../shared/utils/crypto.js";
import {
  AuthUsersRepository,
  type AuthSessionRow,
} from "../repositories/auth-users.repository.js";

export interface ResolvedAuthContext {
  session_id: number;
  session_family_id: string;
  user_id: number;
  username: string;
  email: string;
  is_admin: number;
  email_verified_at: Date | string | null;
  refresh_expires_at: Date | string | null;
  password_changed_at: Date | string | null;
  access_claims: AccessJwtClaims | null;
  access_expires_at: string | null;
}

function toResolvedContext(
  sessionRow: AuthSessionRow | null,
  accessClaims: AccessJwtClaims | null = null,
): ResolvedAuthContext | null {
  if (!sessionRow) return null;
  return {
    session_id: sessionRow.id,
    session_family_id: sessionRow.session_family_id,
    user_id: sessionRow.user_id,
    username: sessionRow.username,
    email: sessionRow.email,
    is_admin: Number(sessionRow.is_admin || 0),
    email_verified_at: sessionRow.email_verified_at || null,
    refresh_expires_at: sessionRow.refresh_expires_at || null,
    password_changed_at: sessionRow.password_changed_at || null,
    access_claims: accessClaims,
    access_expires_at: accessClaims?.exp
      ? new Date(Number(accessClaims.exp) * 1000).toISOString()
      : null,
  };
}

@Injectable()
export class AuthSessionContextService {
  constructor(
    private readonly configService: ConfigService,
    private readonly authUsersRepository: AuthUsersRepository,
  ) {}

  async resolveAccessSession(req: Request): Promise<ResolvedAuthContext | null> {
    const token = getAccessCookie(req);
    if (!token) return null;

    try {
      const { claims } = verifyAccessJwt(this.getJwtSettings(), token);
      const sessionRow = await this.authUsersRepository.getActiveSessionFamily({
        sessionFamilyId: String(claims.sid || ""),
        userId: claims.sub,
      });
      if (!sessionRow) return null;
      return toResolvedContext(sessionRow, claims);
    } catch {
      return null;
    }
  }

  async resolveRefreshSession(req: Request): Promise<ResolvedAuthContext | null> {
    const refreshToken = normalizeOpaqueToken(getRefreshCookie(req));
    if (!refreshToken) return null;

    try {
      const sessionRow =
        await this.authUsersRepository.getActiveSessionByRefreshTokenHash(
          sha256Buffer(refreshToken),
        );
      if (!sessionRow) return null;
      return toResolvedContext(sessionRow, null);
    } catch {
      return null;
    }
  }

  async resolveAccessOrRefreshSession(
    req: Request,
  ): Promise<ResolvedAuthContext | null> {
    const accessContext = await this.resolveAccessSession(req);
    if (accessContext) return accessContext;
    return this.resolveRefreshSession(req);
  }

  private getJwtSettings(): AccessJwtSettings {
    return this.configService.getOrThrow<AccessJwtSettings>("auth");
  }
}
