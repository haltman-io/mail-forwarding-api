import crypto from "node:crypto";
import net from "node:net";
import { Injectable } from "@nestjs/common";

import { PublicHttpException } from "../../shared/errors/public-http.exception.js";
import { sha256Buffer } from "../../shared/utils/crypto.js";
import { packIp16 } from "../../shared/utils/ip-pack.js";
import {
  isValidDomain,
  isValidLocalPart,
  normalizeLowerTrim,
  parseMailbox,
} from "../../shared/validation/mailbox.js";
import { AdminApiTokensRepository } from "./admin-api-tokens.repository.js";
import { AdminBansRepository } from "./admin-bans.repository.js";
import type {
  AdminApiTokensListQueryDto,
  AdminBansListQueryDto,
  AdminCreateApiTokenDto,
  AdminCreateBanDto,
  AdminUpdateApiTokenDto,
  AdminUpdateBanDto,
} from "./admin.dto.js";
import { isApiTokenActive, isBanActive, parsePositiveInt } from "./admin.utils.js";

const ALLOWED_BAN_TYPES = new Set(["email", "domain", "ip", "name"]);
const ALLOWED_TOKEN_STATUS = new Set(["active", "revoked", "expired"]);

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

@Injectable()
export class AdminBansService {
  constructor(private readonly adminBansRepository: AdminBansRepository) {}

  async listBans(query: AdminBansListQueryDto): Promise<{
    items: Array<Record<string, unknown>>;
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

  async getBanById(idRaw: unknown): Promise<{ item: Record<string, unknown> }> {
    const id = parsePositiveInt(idRaw);
    if (!id) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "id" });
    }

    const row = await this.adminBansRepository.getById(id);
    if (!row) {
      throw new PublicHttpException(404, { error: "ban_not_found", id });
    }

    return { item: { ...row, active: isBanActive(row) } };
  }

  async createBan(dto: AdminCreateBanDto): Promise<{
    ok: true;
    created: true;
    item: Record<string, unknown>;
  }> {
    const banType = normalizeLowerTrim(dto.ban_type);
    if (!ALLOWED_BAN_TYPES.has(banType)) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "ban_type" });
    }

    const banValue = normalizeBanValue(banType, dto.ban_value);
    if (!banValue) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "ban_value" });
    }

    const reason = normalizeOptionalReason(dto.reason);
    const created = await this.adminBansRepository.createBan({
      banType,
      banValue,
      reason: reason ?? null,
      expiresAt: dto.expires_at ?? null,
    });
    const row = created.insertId ? await this.adminBansRepository.getById(created.insertId) : null;

    return {
      ok: true,
      created: true,
      item: row ? { ...row, active: isBanActive(row) } : {},
    };
  }

  async updateBan(
    idRaw: unknown,
    dto: AdminUpdateBanDto,
  ): Promise<{ ok: true; updated: true; item: Record<string, unknown> }> {
    const id = parsePositiveInt(idRaw);
    if (!id) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "id" });
    }

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

  async deleteBan(idRaw: unknown): Promise<{
    ok: true;
    deleted: boolean;
    item: Record<string, unknown>;
  }> {
    const id = parsePositiveInt(idRaw);
    if (!id) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "id" });
    }

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

@Injectable()
export class AdminApiTokensService {
  constructor(private readonly adminApiTokensRepository: AdminApiTokensRepository) {}

  async listApiTokens(query: AdminApiTokensListQueryDto): Promise<{
    items: Array<Record<string, unknown>>;
    pagination: { total: number; limit: number; offset: number };
  }> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const [rows, total] = await Promise.all([
      this.adminApiTokensRepository.listAll({
        limit,
        offset,
        ownerEmail: query.owner_email,
        status: query.status,
        active: query.active,
      }),
      this.adminApiTokensRepository.countAll({
        ownerEmail: query.owner_email,
        status: query.status,
        active: query.active,
      }),
    ]);

    return {
      items: rows.map((row) => ({ ...row, active: isApiTokenActive(row) })),
      pagination: { total, limit, offset },
    };
  }

  async getApiTokenById(idRaw: unknown): Promise<{ item: Record<string, unknown> }> {
    const id = parsePositiveInt(idRaw);
    if (!id) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "id" });
    }

    const row = await this.adminApiTokensRepository.getById(id);
    if (!row) {
      throw new PublicHttpException(404, { error: "api_token_not_found", id });
    }

    return { item: { ...row, active: isApiTokenActive(row) } };
  }

  async createApiToken(
    dto: AdminCreateApiTokenDto,
    requestMeta: { ip: string; userAgent: string },
  ): Promise<{
    ok: true;
    created: true;
    token: string;
    token_type: "api_key";
    item: Record<string, unknown>;
  }> {
    const ownerEmail = parseMailbox(dto.owner_email)?.email;
    if (!ownerEmail) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "owner_email" });
    }

    const days = dto.days ?? 30;
    const tokenPlain = crypto.randomBytes(32).toString("hex");
    const tokenHash32 = sha256Buffer(tokenPlain);
    const userAgent =
      dto.user_agent !== undefined
        ? String(dto.user_agent || "").slice(0, 255)
        : String(requestMeta.userAgent || "").slice(0, 255);

    const created = await this.adminApiTokensRepository.createToken({
      ownerEmail,
      tokenHash32,
      days,
      createdIpPacked: packIp16(requestMeta.ip),
      userAgentOrNull: userAgent || null,
    });
    const row = created.insertId
      ? await this.adminApiTokensRepository.getById(created.insertId)
      : null;

    return {
      ok: true,
      created: true,
      token: tokenPlain,
      token_type: "api_key",
      item: row ? { ...row, active: isApiTokenActive(row) } : {},
    };
  }

  async updateApiToken(
    idRaw: unknown,
    dto: AdminUpdateApiTokenDto,
  ): Promise<{ ok: true; updated: true; item: Record<string, unknown> }> {
    const id = parsePositiveInt(idRaw);
    if (!id) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "id" });
    }

    const current = await this.adminApiTokensRepository.getById(id);
    if (!current) {
      throw new PublicHttpException(404, { error: "api_token_not_found", id });
    }

    const patch: {
      ownerEmail?: string;
      status?: string;
      expiresAt?: Date;
      revokedAt?: Date | null;
      revokedReason?: string | null;
    } = {};

    if (dto.owner_email !== undefined) {
      const ownerEmail = parseMailbox(dto.owner_email)?.email;
      if (!ownerEmail) {
        throw new PublicHttpException(400, {
          error: "invalid_params",
          field: "owner_email",
        });
      }
      patch.ownerEmail = ownerEmail;
    }

    if (dto.status !== undefined) {
      const status = normalizeLowerTrim(dto.status);
      if (!ALLOWED_TOKEN_STATUS.has(status)) {
        throw new PublicHttpException(400, { error: "invalid_params", field: "status" });
      }
      patch.status = status;
    }

    if (dto.expires_at !== undefined) {
      if (!dto.expires_at) {
        throw new PublicHttpException(400, { error: "invalid_params", field: "expires_at" });
      }
      patch.expiresAt = dto.expires_at;
    }

    if (dto.revoked !== undefined) {
      if (
        patch.status &&
        ((dto.revoked === 1 && patch.status !== "revoked") ||
          (dto.revoked === 0 && patch.status === "revoked"))
      ) {
        throw new PublicHttpException(400, {
          error: "invalid_params",
          reason: "status_revoked_conflict",
        });
      }

      patch.status = dto.revoked === 1 ? "revoked" : "active";
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

    await this.adminApiTokensRepository.updateById(id, patch);
    const row = await this.adminApiTokensRepository.getById(id);

    return {
      ok: true,
      updated: true,
      item: row ? { ...row, active: isApiTokenActive(row) } : {},
    };
  }

  async deleteApiToken(idRaw: unknown): Promise<{
    ok: true;
    deleted: boolean;
    item: Record<string, unknown>;
  }> {
    const id = parsePositiveInt(idRaw);
    if (!id) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "id" });
    }

    const current = await this.adminApiTokensRepository.getById(id);
    if (!current) {
      throw new PublicHttpException(404, { error: "api_token_not_found", id });
    }

    const deleted = await this.adminApiTokensRepository.deleteById(id);

    return {
      ok: true,
      deleted: Boolean(deleted),
      item: { ...current, active: isApiTokenActive(current) },
    };
  }
}
