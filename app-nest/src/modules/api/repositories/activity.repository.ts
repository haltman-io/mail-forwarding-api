import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../../../shared/database/database.service.js";

export interface ActivityRow {
  type: string;
  occurred_at: Date | string;
  route: string | null;
  intent: string | null;
  alias: string | null;
}

@Injectable()
export class ActivityRepository {
  constructor(private readonly database: DatabaseService) {}

  async listByOwner(
    ownerEmail: string,
    options: { limit: number; offset: number },
  ): Promise<ActivityRow[]> {
    if (!ownerEmail || typeof ownerEmail !== "string") {
      throw new Error("invalid_owner_email");
    }

    const safeLimit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 50;
    const safeOffset =
      Number.isInteger(options.offset) && options.offset >= 0 ? options.offset : 0;
    const normalized = ownerEmail.trim().toLowerCase();

    return this.database.query<ActivityRow[]>(
      `SELECT *
       FROM (
         SELECT
           CASE
             WHEN l.route LIKE '/api/alias/create%' THEN 'alias_create'
             ELSE 'alias_delete'
           END AS type,
           l.created_at AS occurred_at,
           l.route AS route,
           NULL AS intent,
           NULL AS alias
         FROM api_logs l
         WHERE l.api_token_owner_email = ?
           AND (l.route LIKE '/api/alias/create%' OR l.route LIKE '/api/alias/delete%')

         UNION ALL

         SELECT
           CONCAT('confirm_', c.intent) AS type,
           c.confirmed_at AS occurred_at,
           '/forward/confirm' AS route,
           c.intent AS intent,
           CASE
             WHEN c.alias_name IS NOT NULL AND c.alias_domain IS NOT NULL
               THEN CONCAT(c.alias_name, '@', c.alias_domain)
             ELSE NULL
           END AS alias
         FROM email_confirmations c
         WHERE c.email = ?
           AND c.status = 'confirmed'
           AND c.confirmed_at IS NOT NULL
       ) activity
       ORDER BY occurred_at DESC
       LIMIT ? OFFSET ?`,
      [normalized, normalized, safeLimit, safeOffset],
    );
  }
}
