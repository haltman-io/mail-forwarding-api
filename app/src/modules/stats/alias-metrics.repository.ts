import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../../shared/database/database.service.js";

type AliasCountRow = {
  total: number | string | bigint | null;
};

@Injectable()
export class AliasMetricsRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async countVisibleEmailValid(): Promise<number> {
    const rows = await this.databaseService.query<AliasCountRow[]>(
      `SELECT
         (SELECT COUNT(*)
          FROM alias a
          INNER JOIN domain d
            ON d.name = SUBSTRING_INDEX(a.address, '@', -1)
          WHERE a.active = 1
            AND d.active = 1
            AND d.active_mx = 1
            AND d.visible = 1)
       + (SELECT COUNT(*) FROM alias_handle WHERE active = 1)
         * (SELECT COUNT(*)
            FROM domain
            WHERE active = 1
              AND active_mx = 1
              AND visible = 1)
       - (SELECT COUNT(*)
          FROM alias_handle_disabled_domain disabled
          INNER JOIN domain d
            ON d.name = disabled.domain
          WHERE disabled.active = 1
            AND d.active = 1
            AND d.active_mx = 1
            AND d.visible = 1)
       AS total`,
    );

    return Number(rows[0]?.total ?? 0);
  }
}
