import crypto from "node:crypto";
import { Injectable } from "@nestjs/common";

import { PublicHttpException } from "../../../shared/errors/public-http.exception.js";
import { sha256Buffer } from "../../../shared/utils/crypto.js";
import { packIp16 } from "../../../shared/utils/ip-pack.js";
import {
  normalizeLowerTrim,
  parseMailbox,
} from "../../../shared/validation/mailbox.js";
import { AdminApiTokensRepository } from "./admin-api-tokens.repository.js";
import type { AdminApiTokenRow } from "./admin-api-tokens.repository.js";
import type {
  AdminApiTokensListQueryDto,
  AdminCreateApiTokenDto,
  AdminUpdateApiTokenDto,
} from "../dto/admin.dto.js";
import { isApiTokenActive } from "../utils/admin.utils.js";

type AdminApiTokenItem = AdminApiTokenRow & { active: boolean };

const ALLOWED_TOKEN_STATUS = new Set(["active", "revoked", "expired"]);

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

@Injectable()
export class AdminApiTokensService {
  constructor(private readonly adminApiTokensRepository: AdminApiTokensRepository) {}

  async listApiTokens(query: AdminApiTokensListQueryDto): Promise<{
    items: Array<AdminApiTokenItem>;
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

  async getApiTokenById(id: number): Promise<{ item: AdminApiTokenItem }> {
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
    item: AdminApiTokenItem | Record<string, never>;
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
    id: number,
    dto: AdminUpdateApiTokenDto,
  ): Promise<{ ok: true; updated: true; item: AdminApiTokenItem | Record<string, never> }> {
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

  async deleteApiToken(id: number): Promise<{
    ok: true;
    deleted: boolean;
    item: AdminApiTokenItem;
  }> {
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
