import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../../shared/database/database.service.js";

type DomainNameRow = {
  name: string;
};

type DomainCountRow = {
  total: number | string | bigint | null;
};

export type DomainRow = {
  id: number;
  name: string;
  active: number;
};

@Injectable()
export class DomainRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async listActiveNames(): Promise<string[]> {
    const rows = await this.databaseService.query<DomainNameRow[]>(
      "SELECT name FROM domain WHERE active = 1 ORDER BY id ASC",
    );

    return rows
      .filter((row) => typeof row?.name === "string")
      .map((row) => row.name);
  }

  async getActiveByName(name: string): Promise<DomainRow | null> {
    const rows = await this.databaseService.query<DomainRow[]>(
      "SELECT id, name, active FROM domain WHERE name = ? AND active = 1 LIMIT 1",
      [name],
    );

    return rows[0] ?? null;
  }

  async countActive(): Promise<number> {
    const rows = await this.databaseService.query<DomainCountRow[]>(
      "SELECT COUNT(*) AS total FROM domain WHERE active = 1",
    );

    return Number(rows[0]?.total ?? 0);
  }
}
