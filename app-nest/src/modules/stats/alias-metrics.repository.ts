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
      "SELECT COUNT(*) AS total FROM alias WHERE active = 1",
    );

    return Number(rows[0]?.total ?? 0);
  }
}
