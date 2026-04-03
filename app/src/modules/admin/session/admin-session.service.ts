import { Injectable } from "@nestjs/common";

import { PublicHttpException } from "../../../shared/errors/public-http.exception.js";
import type { ResolvedAuthContext } from "../../auth/services/auth-session-context.service.js";
import { AdminUsersRepository } from "../users/admin-users.repository.js";
import { toAdminPublicUser } from "../utils/admin.utils.js";

@Injectable()
export class AdminSessionService {
  constructor(private readonly adminUsersRepository: AdminUsersRepository) {}

  async getAdminMe(authContext: ResolvedAuthContext): Promise<{
    ok: true;
    authenticated: true;
    admin: ReturnType<typeof toAdminPublicUser>;
    session: {
      session_family_id: string | null;
      access_expires_at: string | null;
      refresh_expires_at: Date | string | null;
    };
  }> {
    const userId = Number(authContext?.user_id || 0);
    if (!Number.isInteger(userId) || userId <= 0) {
      throw new PublicHttpException(401, { error: "invalid_or_expired_session" });
    }

    const user = await this.adminUsersRepository.getUserById(userId);
    if (!user || Number(user.is_active || 0) !== 1) {
      throw new PublicHttpException(401, { error: "invalid_or_expired_session" });
    }

    return {
      ok: true,
      authenticated: true,
      admin: toAdminPublicUser(user),
      session: {
        session_family_id: authContext?.session_family_id || null,
        access_expires_at: authContext?.access_expires_at || null,
        refresh_expires_at: authContext?.refresh_expires_at || null,
      },
    };
  }
}
