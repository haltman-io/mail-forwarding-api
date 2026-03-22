import { Injectable } from "@nestjs/common";

import { DomainRepository } from "./domain.repository.js";

interface DomainsCache {
  at: number;
  data: string[] | null;
}

@Injectable()
export class DomainsService {
  private cache: DomainsCache = { at: 0, data: null };
  private readonly cacheTtlMs = 10_000;

  constructor(private readonly domainRepository: DomainRepository) {}

  async getDomains(): Promise<{ data: string[]; fromCache: boolean }> {
    const now = Date.now();
    if (this.cache.data && now - this.cache.at < this.cacheTtlMs) {
      return {
        data: this.cache.data,
        fromCache: true,
      };
    }

    const names = await this.domainRepository.listActiveNames();
    this.cache = { at: now, data: names };
    return {
      data: names,
      fromCache: false,
    };
  }
}
