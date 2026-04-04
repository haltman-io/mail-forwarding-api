import net from "node:net";
import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../../../shared/database/database.service.js";
import { PublicHttpException } from "../../../shared/errors/public-http.exception.js";
import {
  isValidDomain,
  isValidLocalPart,
  normalizeLowerTrim,
  parseMailbox,
} from "../../../shared/validation/mailbox.js";
import { withTxRetry } from "../utils/admin-database.utils.js";
import { AdminAliasesRepository } from "../aliases/admin-aliases.repository.js";
import { AdminBansRepository } from "./admin-bans.repository.js";
import type {
  AdminBansListQueryDto,
  AdminCreateBanDto,
  AdminUpdateBanDto,
} from "../dto/admin.dto.js";
import type { AdminBanRow } from "./admin-bans.repository.js";
import { isBanActive } from "../utils/admin.utils.js";

type AdminBanItem = AdminBanRow & { active: boolean };

const ALLOWED_BAN_TYPES = new Set(["email", "domain", "ip", "name"]);

function normalizeOptionalReason(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;

  const value = String(raw).trim();
  if (!value) return null;
  if (value.length > 255) {
    throw new PublicHttpException(400, { error: "invalid_params", field: "reason" });
  }
  return value;
}

function normalizeOptionalRevokedReason(raw: unknown): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;

  const value = String(raw).trim();
  if (!value) return null;
  if (value.length > 255) {
    throw new PublicHttpException(400, {
      error: "invalid_params",
      field: "revoked_reason",
    });
  }
  return value;
}

function normalizeBanValue(banType: string, raw: unknown): string | null {
  if (banType === "email") {
    return parseMailbox(raw)?.email ?? null;
  }
  if (banType === "domain") {
    const value = normalizeLowerTrim(raw);
    return value && isValidDomain(value) ? value : null;
  }
  if (banType === "name") {
    const value = normalizeLowerTrim(raw);
    return value && isValidLocalPart(value) ? value : null;
  }
  if (banType === "ip") {
    const value = String(raw || "").trim();
    return net.isIP(value) ? value : null;
  }
  return null;
}

function formatCreateBanMessage(
  disableMatchingAliases: boolean,
  disabledAliases: number,
): string {
  if (!disableMatchingAliases) {
    return "Ban created.";
  }

  return `Ban created. Also, ${disabledAliases} matching ${
    disabledAliases === 1 ? "alias was" : "aliases were"
  } disabled.`;
}

@Injectable()
export class AdminBansService {
  constructor(
    private readonly database: DatabaseService,
    private readonly adminBansRepository: AdminBansRepository,
    private readonly adminAliasesRepository: AdminAliasesRepository,
  ) {}

  async listBans(query: AdminBansListQueryDto): Promise<{
    items: Array<AdminBanItem>;
    pagination: { total: number; limit: number; offset: number };
  }> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const [rows, total] = await Promise.all([
      this.adminBansRepository.listAll({
        limit,
        offset,
        banType: query.ban_type,
        banValue: query.ban_value,
        active: query.active,
      }),
      this.adminBansRepository.countAll({
        banType: query.ban_type,
        banValue: query.ban_value,
        active: query.active,
      }),
    ]);

    return {
      items: rows.map((row) => ({ ...row, active: isBanActive(row) })),
      pagination: { total, limit, offset },
    };
  }

  async getBanById(id: number): Promise<{ item: AdminBanItem }> {
    const row = await this.adminBansRepository.getById(id);
    if (!row) {
      throw new PublicHttpException(404, { error: "ban_not_found", id });
    }

    return { item: { ...row, active: isBanActive(row) } };
  }

  async createBan(dto: AdminCreateBanDto): Promise<{
    ok: true;
    created: true;
    item: AdminBanItem | Record<string, never>;
    disabled_aliases: number;
    message: string;
  }> {
    const banType = normalizeLowerTrim(dto.ban_type);
    if (!ALLOWED_BAN_TYPES.has(banType)) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "ban_type" });
    }

    const banValue = normalizeBanValue(banType, dto.ban_value);
    if (!banValue) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "ban_value" });
    }

    const disableMatchingAliases = dto.disable_matching_aliases === true;
    if (disableMatchingAliases && banType === "ip") {
      throw new PublicHttpException(400, {
        error: "invalid_params",
        field: "disable_matching_aliases",
        reason: "not_supported_for_ip_bans",
      });
    }

    const reason = normalizeOptionalReason(dto.reason);
    const result = await withTxRetry(this.database, async (connection) => {
      const created = await this.adminBansRepository.createBan(
        {
          banType,
          banValue,
          reason: reason ?? null,
          expiresAt: dto.expires_at ?? null,
        },
        connection,
      );

      const disabledAliases = disableMatchingAliases
        ? await this.adminAliasesRepository.disableMatchingActiveAliasesForBan(
            { banType, banValue },
            connection,
          )
        : 0;

      return {
        insertId: created.insertId,
        disabledAliases,
      };
    });
    const row = result.insertId ? await this.adminBansRepository.getById(result.insertId) : null;

    return {
      ok: true,
      created: true,
      item: row ? { ...row, active: isBanActive(row) } : {},
      disabled_aliases: result.disabledAliases,
      message: formatCreateBanMessage(disableMatchingAliases, result.disabledAliases),
    };
  }

  async updateBan(
    id: number,
    dto: AdminUpdateBanDto,
  ): Promise<{ ok: true; updated: true; item: AdminBanItem | Record<string, never> }> {
    const current = await this.adminBansRepository.getById(id);
    if (!current) {
      throw new PublicHttpException(404, { error: "ban_not_found", id });
    }

    const patch: {
      banType?: string;
      banValue?: string;
      reason?: string | null;
      expiresAt?: Date | null;
      revokedAt?: Date | null;
      revokedReason?: string | null;
    } = {};

    const nextType = dto.ban_type !== undefined ? normalizeLowerTrim(dto.ban_type) : current.ban_type;
    if (!ALLOWED_BAN_TYPES.has(nextType)) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "ban_type" });
    }

    const nextValue = normalizeBanValue(
      nextType,
      dto.ban_value !== undefined ? dto.ban_value : current.ban_value,
    );
    if (!nextValue) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "ban_value" });
    }

    if (dto.ban_type !== undefined) patch.banType = nextType;
    if (dto.ban_value !== undefined) patch.banValue = nextValue;
    if (dto.reason !== undefined) patch.reason = normalizeOptionalReason(dto.reason) ?? null;
    if (dto.expires_at !== undefined) patch.expiresAt = dto.expires_at ?? null;

    if (dto.revoked !== undefined) {
      patch.revokedAt = dto.revoked === 1 ? new Date() : null;
      if (dto.revoked === 0 && dto.revoked_reason === undefined) {
        patch.revokedReason = null;
      }
    }

    if (dto.revoked_reason !== undefined) {
      patch.revokedReason = normalizeOptionalRevokedReason(dto.revoked_reason) ?? null;
    }

    if (Object.keys(patch).length === 0) {
      throw new PublicHttpException(400, {
        error: "invalid_params",
        reason: "empty_patch",
      });
    }

    await this.adminBansRepository.updateById(id, patch);
    const row = await this.adminBansRepository.getById(id);

    return {
      ok: true,
      updated: true,
      item: row ? { ...row, active: isBanActive(row) } : {},
    };
  }

  async deleteBan(id: number): Promise<{
    ok: true;
    deleted: boolean;
    item: AdminBanItem;
  }> {
    const current = await this.adminBansRepository.getById(id);
    if (!current) {
      throw new PublicHttpException(404, { error: "ban_not_found", id });
    }

    const deleted = await this.adminBansRepository.deleteById(id);

    return {
      ok: true,
      deleted: Boolean(deleted),
      item: { ...current, active: isBanActive(current) },
    };
  }
}
