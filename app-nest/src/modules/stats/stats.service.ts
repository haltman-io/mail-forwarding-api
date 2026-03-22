import { Injectable } from "@nestjs/common";

import { DomainRepository } from "../domains/domain.repository.js";
import { AliasMetricsRepository } from "./alias-metrics.repository.js";

interface StatsCache {
  at: number;
  data: { domains: number; aliases: number } | null;
}

@Injectable()
export class StatsService {
  private cache: StatsCache = { at: 0, data: null };
  private readonly cacheTtlMs = 60_000;

  constructor(
    private readonly domainRepository: DomainRepository,
    private readonly aliasMetricsRepository: AliasMetricsRepository
  ) {}

  async getStats(): Promise<{ data: { domains: number; aliases: number }; fromCache: boolean }> {
    const now = Date.now();
    if (this.cache.data && now - this.cache.at < this.cacheTtlMs) {
      return {
        data: this.cache.data,
        fromCache: true,
      };
    }

    const [domains, aliases] = await Promise.all([
      this.domainRepository.countActive(),
      this.aliasMetricsRepository.countActive(),
    ]);

    const data = { domains, aliases };
    this.cache = { at: now, data };
    return {
      data,
      fromCache: false,
    };
  }
}
