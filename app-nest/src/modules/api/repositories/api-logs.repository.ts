import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../../../shared/database/database.service.js";

@Injectable()
export class ApiLogsRepository {
  constructor(private readonly database: DatabaseService) {}

  async insert(payload: {
    apiTokenId: number | null;
    ownerEmail: string | null;
    route: string;
    body: string | null;
    requestIpPacked: Buffer | null;
    userAgent: string | null;
  }): Promise<void> {
    await this.database.query(
      `INSERT INTO api_logs (
        api_token_id, api_token_owner_email, created_at, route, body, request_ip, user_agent
      ) VALUES (
        ?, ?, NOW(6), ?, ?, ?, ?
      )`,
      [
        payload.apiTokenId,
        payload.ownerEmail,
        String(payload.route || "").slice(0, 128),
        payload.body ?? null,
        payload.requestIpPacked ?? null,
        payload.userAgent ?? null,
      ],
    );
  }
}
