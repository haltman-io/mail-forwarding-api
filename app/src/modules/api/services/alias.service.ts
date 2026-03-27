import { Injectable } from "@nestjs/common";

import { PublicHttpException } from "../../../shared/errors/public-http.exception.js";
import { AppLogger } from "../../../shared/logging/app-logger.service.js";
import {
  normalizeLowerTrim,
  isValidLocalPart,
  isValidDomain,
  parseMailbox,
} from "../../../shared/validation/mailbox.js";
import { BanPolicyService } from "../../bans/ban-policy.service.js";
import { DomainRepository } from "../../domains/domain.repository.js";
import { AliasRepository } from "../repositories/alias.repository.js";
import { ActivityRepository } from "../repositories/activity.repository.js";

@Injectable()
export class AliasService {
  constructor(
    private readonly aliasRepository: AliasRepository,
    private readonly activityRepository: ActivityRepository,
    private readonly domainRepository: DomainRepository,
    private readonly banPolicyService: BanPolicyService,
    private readonly logger: AppLogger,
  ) {}

  async listAliases(params: {
    ownerEmail: string;
    limit: number;
    offset: number;
  }): Promise<{
    items: unknown[];
    pagination: { total: number; limit: number; offset: number };
  }> {
    const [items, total] = await Promise.all([
      this.aliasRepository.listByGoto(params.ownerEmail, { limit: params.limit, offset: params.offset }),
      this.aliasRepository.countByGoto(params.ownerEmail),
    ]);

    return {
      items,
      pagination: {
        total,
        limit: params.limit,
        offset: params.offset,
      },
    };
  }

  async getAliasStats(ownerEmail: string): Promise<unknown> {
    return this.aliasRepository.getStatsByGoto(ownerEmail);
  }

  async getActivity(params: {
    ownerEmail: string;
    limit: number;
    offset: number;
  }): Promise<{
    items: unknown[];
    pagination: { limit: number; offset: number };
  }> {
    const items = await this.activityRepository.listByOwner(params.ownerEmail, {
      limit: params.limit,
      offset: params.offset,
    });

    return {
      items,
      pagination: {
        limit: params.limit,
        offset: params.offset,
      },
    };
  }

  async createAlias(params: {
    ownerEmail: string;
    aliasHandle: unknown;
    aliasDomain: unknown;
  }): Promise<{ ok: true; created: true; address: string; goto: string }> {
    const aliasHandle = normalizeLowerTrim(params.aliasHandle);
    const aliasDomain = normalizeLowerTrim(params.aliasDomain);

    if (!aliasHandle) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "alias_handle" });
    }
    if (!aliasDomain) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "alias_domain" });
    }
    if (!isValidLocalPart(aliasHandle)) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "alias_handle" });
    }
    if (!isValidDomain(aliasDomain)) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "alias_domain" });
    }

    const banName = await this.banPolicyService.findActiveNameBan(aliasHandle);
    if (banName) {
      throw new PublicHttpException(403, { error: "banned", ban: banName });
    }

    const banAliasDomain = await this.banPolicyService.findActiveDomainBan(aliasDomain);
    if (banAliasDomain) {
      throw new PublicHttpException(403, { error: "banned", ban: banAliasDomain });
    }

    const banOwner = await this.banPolicyService.findActiveEmailOrDomainBan(params.ownerEmail);
    if (banOwner) {
      throw new PublicHttpException(403, { error: "banned", ban: banOwner });
    }

    const domainRow = await this.domainRepository.getActiveByName(aliasDomain);
    if (!domainRow) {
      throw new PublicHttpException(400, { error: "invalid_domain", field: "alias_domain" });
    }

    const address = `${aliasHandle}@${aliasDomain}`;

    const reservedHandle = await this.aliasRepository.existsReservedHandle(aliasHandle);
    if (reservedHandle) {
      throw new PublicHttpException(409, { ok: false, error: "alias_taken", address });
    }

    const created = await this.aliasRepository.createIfNotExists({
      address,
      goto: params.ownerEmail,
      domainId: domainRow.id,
      active: 1,
    });

    if (created.alreadyExists) {
      throw new PublicHttpException(409, { ok: false, error: "alias_taken", address });
    }

    return { ok: true, created: true, address, goto: params.ownerEmail };
  }

  async deleteAlias(params: {
    ownerEmail: string;
    alias: unknown;
  }): Promise<{ ok: true; deleted: true; alias: string }> {
    const parsed = parseMailbox(params.alias);
    if (!parsed) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "alias" });
    }

    const row = await this.aliasRepository.getByAddress(parsed.email);
    if (!row) {
      throw new PublicHttpException(404, { error: "alias_not_found", alias: parsed.email });
    }

    const goto = String(row.goto || "").trim().toLowerCase();
    if (goto !== params.ownerEmail) {
      throw new PublicHttpException(403, { error: "forbidden" });
    }

    const result = await this.aliasRepository.deleteByAddress(parsed.email);
    if (!result.deleted) {
      throw new PublicHttpException(404, { error: "alias_not_found", alias: parsed.email });
    }

    return { ok: true, deleted: true, alias: parsed.email };
  }

  static parsePagination(
    query: Record<string, unknown>,
    options: { defaultLimit?: number; maxLimit?: number } = {},
  ): { limit: number; offset: number } {
    const defaultLimit = options.defaultLimit ?? 50;
    const maxLimit = options.maxLimit ?? 200;

    const limitRaw = query?.limit;
    const offsetRaw = query?.offset;

    const limitNum = limitRaw === undefined ? defaultLimit : Number(limitRaw);
    const offsetNum = offsetRaw === undefined ? 0 : Number(offsetRaw);

    if (!Number.isInteger(limitNum) || limitNum <= 0) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "limit" });
    }
    if (!Number.isInteger(offsetNum) || offsetNum < 0) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "offset" });
    }

    return {
      limit: Math.min(limitNum, maxLimit),
      offset: offsetNum,
    };
  }
}
