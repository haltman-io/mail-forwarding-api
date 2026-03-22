import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../../shared/database/database.service.js";

const ACTIVE_WHERE =
  "revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW(6))";

export interface BanRow {
  ban_type: string;
  ban_value: string;
  reason: string | null;
  banned_at: string | Date;
}

@Injectable()
export class BansRepository {
  constructor(private readonly database: DatabaseService) {}

  async getActiveBanByValues(banType: string, banValues: string[]): Promise<BanRow | null> {
    const uniqueValues = Array.from(
      new Set(
        banValues
          .map((value) => String(value ?? "").trim().toLowerCase())
          .filter(Boolean)
      )
    );

    if (!banType || uniqueValues.length === 0) {
      return null;
    }

    if (banType === "ip") {
      const ipWhere = uniqueValues
        .map(() => "INET6_ATON(ban_value) = INET6_ATON(?)")
        .join(" OR ");

      const rows = await this.database.query<BanRow[]>(
        `SELECT ban_type, ban_value, reason, created_at AS banned_at
         FROM api_bans
         WHERE ban_type = ?
           AND (${ipWhere})
           AND ${ACTIVE_WHERE}
         ORDER BY id DESC
         LIMIT 1`,
        [banType, ...uniqueValues]
      );

      return rows[0] ?? null;
    }

    const placeholders = uniqueValues.map(() => "?").join(", ");
    const rows = await this.database.query<BanRow[]>(
      `SELECT ban_type, ban_value, reason, created_at AS banned_at
       FROM api_bans
       WHERE ban_type = ?
         AND ban_value IN (${placeholders})
         AND ${ACTIVE_WHERE}
       ORDER BY id DESC
       LIMIT 1`,
      [banType, ...uniqueValues]
    );

    return rows[0] ?? null;
  }
}
