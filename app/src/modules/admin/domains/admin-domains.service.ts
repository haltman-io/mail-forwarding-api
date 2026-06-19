import { Injectable } from "@nestjs/common";
import axios from "axios";

import { isDuplicateEntry } from "../../../shared/database/database.utils.js";
import { PublicHttpException } from "../../../shared/errors/public-http.exception.js";
import { AppLogger } from "../../../shared/logging/app-logger.service.js";
import {
  INVALID_TARGET_ERROR,
  normalizeDomainTarget,
} from "../../../shared/validation/domain-target.js";
import { isValidDomain } from "../../../shared/validation/mailbox.js";
import { BanPolicyService } from "../../bans/ban-policy.service.js";
import { CheckDnsClient } from "../../check-dns/check-dns.client.js";
import { AdminDomainsRepository } from "./admin-domains.repository.js";
import type { AdminDomainRow } from "./admin-domains.repository.js";
import type {
  AdminCreateDomainDto,
  AdminDomainsListQueryDto,
  AdminUpdateDomainDto,
} from "../dto/admin.dto.js";

export interface AdminDnsRecheckResult {
  status: number;
  payload: unknown;
}

@Injectable()
export class AdminDomainsService {
  constructor(
    private readonly adminDomainsRepository: AdminDomainsRepository,
    private readonly banPolicyService: BanPolicyService,
    private readonly checkDnsClient: CheckDnsClient,
    private readonly logger: AppLogger,
  ) {}

  async listDomains(query: AdminDomainsListQueryDto): Promise<{
    items: Awaited<ReturnType<AdminDomainsRepository["listAll"]>>;
    pagination: { total: number; limit: number; offset: number };
  }> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const [items, total] = await Promise.all([
      this.adminDomainsRepository.listAll({
        limit,
        offset,
        active: query.active,
        visible: query.visible,
        name: query.name,
      }),
      this.adminDomainsRepository.countAll({
        active: query.active,
        visible: query.visible,
        name: query.name,
      }),
    ]);

    return {
      items,
      pagination: { total, limit, offset },
    };
  }

  async getDomainById(id: number): Promise<{ item: AdminDomainRow }> {
    const row = await this.adminDomainsRepository.getById(id);
    if (!row) {
      throw new PublicHttpException(404, { error: "domain_not_found", id });
    }

    return { item: row };
  }

  async createDomain(dto: AdminCreateDomainDto): Promise<{
    ok: true;
    created: true;
    item: AdminDomainRow | null;
  }> {
    const name = String(dto.name || "").trim().toLowerCase();
    if (!name || !isValidDomain(name)) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "name" });
    }

    const ban = await this.banPolicyService.findActiveDomainBan(name);
    if (ban) {
      throw new PublicHttpException(403, { error: "banned", ban });
    }

    const active = dto.active === undefined ? 1 : dto.active;
    const visible = dto.visible === undefined ? 1 : dto.visible;
    const existing = await this.adminDomainsRepository.getByName(name);
    if (existing) {
      throw new PublicHttpException(409, { error: "domain_taken", name });
    }

    try {
      const created = await this.adminDomainsRepository.createDomain({ name, active, visible });
      const row = created.insertId
        ? await this.adminDomainsRepository.getById(created.insertId)
        : null;

      return {
        ok: true,
        created: true,
        item: row,
      };
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw new PublicHttpException(409, { error: "domain_taken", name });
      }
      throw error;
    }
  }

  async updateDomain(
    id: number,
    dto: AdminUpdateDomainDto,
  ): Promise<{ ok: true; updated: true; item: AdminDomainRow | null }> {
    const current = await this.adminDomainsRepository.getById(id);
    if (!current) {
      throw new PublicHttpException(404, { error: "domain_not_found", id });
    }

    const patch: { name?: string; active?: number; visible?: number } = {};
    let nextName = String(current.name || "").trim().toLowerCase();

    if (dto.name !== undefined) {
      const next = String(dto.name || "").trim().toLowerCase();
      if (!next || !isValidDomain(next)) {
        throw new PublicHttpException(400, { error: "invalid_params", field: "name" });
      }

      const conflict = await this.adminDomainsRepository.getByName(next);
      if (conflict && Number(conflict.id) !== id) {
        throw new PublicHttpException(409, { error: "domain_taken", name: next });
      }

      const ban = await this.banPolicyService.findActiveDomainBan(next);
      if (ban) {
        throw new PublicHttpException(403, { error: "banned", ban });
      }

      patch.name = next;
      nextName = next;
    }

    if (dto.active !== undefined) {
      patch.active = dto.active;
    }

    if (dto.visible !== undefined) {
      patch.visible = dto.visible;
    }

    const nextActive =
      patch.active === 0 || patch.active === 1 ? patch.active : Number(current.active || 0);
    if (nextActive === 1) {
      const activeBan = await this.banPolicyService.findActiveDomainBan(nextName);
      if (activeBan) {
        throw new PublicHttpException(403, { error: "banned", ban: activeBan });
      }
    }

    if (Object.keys(patch).length === 0) {
      throw new PublicHttpException(400, {
        error: "invalid_params",
        reason: "empty_patch",
      });
    }

    try {
      await this.adminDomainsRepository.updateById(id, patch);
      const row = await this.adminDomainsRepository.getById(id);
      return { ok: true, updated: true, item: row };
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw new PublicHttpException(409, { error: "domain_taken", name: nextName });
      }
      throw error;
    }
  }

  async deleteDomain(id: number): Promise<{
    ok: true;
    deleted: boolean;
    item: AdminDomainRow;
  }> {
    const current = await this.adminDomainsRepository.getById(id);
    if (!current) {
      throw new PublicHttpException(404, { error: "domain_not_found", id });
    }

    const deleted = await this.adminDomainsRepository.deleteById(id);

    return {
      ok: true,
      deleted: Boolean(deleted),
      item: current,
    };
  }

  async recheckAllDomains(): Promise<AdminDnsRecheckResult> {
    return this.relayDnsRecheck("POST /api/admin/domains/recheckdns/all", "all", () =>
      this.checkDnsClient.recheckAllDomains(),
    );
  }

  async recheckDomain(id: number): Promise<AdminDnsRecheckResult> {
    const row = await this.adminDomainsRepository.getById(id);
    if (!row) {
      throw new PublicHttpException(404, { error: "domain_not_found", id });
    }

    const normalized = normalizeDomainTarget(row.name);
    if (!normalized.ok) {
      throw new PublicHttpException(500, {
        error: "invalid_domain_state",
        id,
        field: "name",
        reason: normalized.error || INVALID_TARGET_ERROR,
      });
    }

    return this.relayDnsRecheck(
      "POST /api/admin/domains/:id/recheckdns",
      normalized.value,
      () => this.checkDnsClient.recheckDomain(normalized.value),
    );
  }

  private async relayDnsRecheck(
    routeName: string,
    target: string,
    action: () => Promise<{ status: number; data: unknown }>,
  ): Promise<AdminDnsRecheckResult> {
    const startedAt = process.hrtime.bigint();

    try {
      const response = await action();
      this.logger.info("admin.domains.recheck.relay", {
        route: routeName,
        target,
        upstream_status: response.status,
        duration_ms: this.durationMs(startedAt),
      });

      return {
        status: response.status || 502,
        payload: response.data,
      };
    } catch (error) {
      const status = axios.isAxiosError(error) && error.code === "ECONNABORTED" ? 503 : 502;
      this.logger.error("admin.domains.recheck.error", {
        route: routeName,
        target,
        duration_ms: this.durationMs(startedAt),
        err: error,
      });

      return {
        status,
        payload: { error: "internal_error" },
      };
    }
  }

  private durationMs(startedAt: bigint): number {
    return Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
  }

}
