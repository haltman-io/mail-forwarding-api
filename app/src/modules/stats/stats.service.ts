import { Injectable } from "@nestjs/common";

import { DomainRepository } from "../domains/domain.repository.js";
import { AliasMetricsRepository } from "./alias-metrics.repository.js";
import { ForwardCounterRepository } from "./forward-counter.repository.js";

interface StatsData {
  domains: number;
  aliases: number;
  forwarded: number;
}

interface StatsCache {
  at: number;
  data: StatsData | null;
}

@Injectable()
export class StatsService {
  private cache: StatsCache = { at: 0, data: null };
  private readonly cacheTtlMs = 120_000;

  constructor(
    private readonly domainRepository: DomainRepository,
    private readonly aliasMetricsRepository: AliasMetricsRepository,
    private readonly forwardCounterRepository: ForwardCounterRepository,
  ) {}

  async getStats(): Promise<{ data: StatsData; fromCache: boolean }> {
    const now = Date.now();
    if (this.cache.data && now - this.cache.at < this.cacheTtlMs) {
      return {
        data: this.cache.data,
        fromCache: true,
      };
    }

    const [domains, aliases, forwarded] = await Promise.all([
      this.domainRepository.countActive(),
      this.aliasMetricsRepository.countActive(),
      this.forwardCounterRepository.getTotal(),
    ]);

    const data = { domains, aliases, forwarded };
    this.cache = { at: now, data };
    return {
      data,
      fromCache: false,
    };
  }
}
