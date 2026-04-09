import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../../shared/database/database.service.js";

type AliasCountRow = {
  total: number | string | bigint | null;
};

@Injectable()
export class AliasMetricsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async countActive(): Promise<number> {
    const rows = await this.databaseService.query<AliasCountRow[]>(
      `SELECT
         (SELECT COUNT(*) FROM alias WHERE active = 1)
       + (SELECT COUNT(*) FROM alias_handle WHERE active = 1)
         * (SELECT COUNT(*) FROM domain WHERE active = 1)
       - (SELECT COUNT(*) FROM alias_handle_disabled_domain WHERE active = 1)
       AS total`,
    );

    return Number(rows[0]?.total ?? 0);
  }
}
