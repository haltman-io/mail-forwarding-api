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
  active_mx: number;
  active_ui: number;
  visible: number;
};

@Injectable()
export class DomainRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async listVisibleEmailValidNames(): Promise<string[]> {
    const rows = await this.databaseService.query<DomainNameRow[]>(
      `SELECT name
       FROM domain
       WHERE active = 1
         AND active_mx = 1
         AND visible = 1
       ORDER BY id ASC`,
    );

    return rows
      .filter((row) => typeof row?.name === "string")
      .map((row) => row.name);
  }

  async getEmailValidByName(name: string): Promise<DomainRow | null> {
    const rows = await this.databaseService.query<DomainRow[]>(
      `SELECT id, name, active, active_mx, active_ui, visible
       FROM domain
       WHERE name = ?
         AND active = 1
         AND active_mx = 1
       LIMIT 1`,
      [name],
    );

    return rows[0] ?? null;
  }

  async getUiValidByName(name: string): Promise<DomainRow | null> {
    const rows = await this.databaseService.query<DomainRow[]>(
      `SELECT id, name, active, active_mx, active_ui, visible
       FROM domain
       WHERE name = ?
         AND active = 1
         AND active_ui = 1
       LIMIT 1`,
      [name],
    );

    return rows[0] ?? null;
  }

  async getAdminActiveByName(name: string): Promise<DomainRow | null> {
    const rows = await this.databaseService.query<DomainRow[]>(
      `SELECT id, name, active, active_mx, active_ui, visible
       FROM domain
       WHERE name = ?
         AND active = 1
       LIMIT 1`,
      [name],
    );

    return rows[0] ?? null;
  }

  async countVisibleEmailValid(): Promise<number> {
    const rows = await this.databaseService.query<DomainCountRow[]>(
      `SELECT COUNT(*) AS total
       FROM domain
       WHERE active = 1
         AND active_mx = 1
         AND visible = 1`,
    );

    return Number(rows[0]?.total ?? 0);
  }
}
