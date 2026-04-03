import { Injectable } from "@nestjs/common";

import { isDuplicateEntry } from "../../../shared/database/database.utils.js";
import { PublicHttpException } from "../../../shared/errors/public-http.exception.js";
import { isValidDomain } from "../../../shared/validation/mailbox.js";
import { BanPolicyService } from "../../bans/ban-policy.service.js";
import { AdminDomainsRepository } from "./admin-domains.repository.js";
import type { AdminDomainRow } from "./admin-domains.repository.js";
import type {
  AdminCreateDomainDto,
  AdminDomainsListQueryDto,
  AdminUpdateDomainDto,
} from "../dto/admin.dto.js";

@Injectable()
export class AdminDomainsService {
  constructor(
    private readonly adminDomainsRepository: AdminDomainsRepository,
    private readonly banPolicyService: BanPolicyService,
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
        name: query.name,
      }),
      this.adminDomainsRepository.countAll({
        active: query.active,
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
    const existing = await this.adminDomainsRepository.getByName(name);
    if (existing) {
      throw new PublicHttpException(409, { error: "domain_taken", name });
    }

    try {
      const created = await this.adminDomainsRepository.createDomain({ name, active });
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

    const patch: { name?: string; active?: number } = {};
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

}
