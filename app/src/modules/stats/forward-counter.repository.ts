import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../../shared/database/database.service.js";

type ForwardCounterRow = {
  total: number | string | bigint | null;
};

@Injectable()
export class ForwardCounterRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async getTotal(): Promise<number> {
    const rows = await this.databaseService.query<ForwardCounterRow[]>(
      "SELECT total FROM mail_forward_counter WHERE id = 1",
    );

    return Number(rows[0]?.total ?? 0);
  }

  async increment(): Promise<void> {
    await this.databaseService.query(
      "UPDATE mail_forward_counter SET total = total + 1 WHERE id = 1",
    );
  }
}
