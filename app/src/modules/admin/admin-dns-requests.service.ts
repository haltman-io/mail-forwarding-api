import { Injectable } from "@nestjs/common";

import { PublicHttpException } from "../../shared/errors/public-http.exception.js";
import {
  INVALID_TARGET_ERROR,
  normalizeDomainTarget,
} from "../../shared/validation/domain-target.js";
import type {
  AdminCreateDnsRequestDto,
  AdminDnsRequestsListQueryDto,
  AdminUpdateDnsRequestDto,
} from "./admin.dto.js";
import {
  AdminDnsRequestsRepository,
  type AdminDnsRequestRow,
} from "./admin-dns-requests.repository.js";
import { parsePositiveInt } from "./admin.utils.js";

const MAX_TEXT_LENGTH = 65535;

function normalizeDnsRequestType(raw: unknown): "UI" | "EMAIL" {
  const value = String(raw ?? "").trim().toUpperCase();
  if (value !== "UI" && value !== "EMAIL") {
    throw new PublicHttpException(400, { error: "invalid_params", field: "type" });
  }
  return value;
}

function normalizeDnsRequestStatus(raw: unknown): string {
  const value = String(raw ?? "").trim().toUpperCase();
  if (!value || value.length > 16) {
    throw new PublicHttpException(400, { error: "invalid_params", field: "status" });
  }
  return value;
}

function normalizeDnsTarget(raw: unknown): string {
  const normalized = normalizeDomainTarget(raw);
  if (!normalized.ok) {
    throw new PublicHttpException(400, {
      error: "invalid_params",
      field: "target",
      reason: normalized.error || INVALID_TARGET_ERROR,
    });
  }

  return normalized.value;
}

function normalizeOptionalText(
  raw: unknown,
  field: string,
): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;

  const value = String(raw).trim();
  if (!value) return null;
  if (value.length > MAX_TEXT_LENGTH) {
    throw new PublicHttpException(400, { error: "invalid_params", field });
  }
  return value;
}

function normalizeOptionalJsonText(
  raw: unknown,
): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;

  let jsonText: string | undefined;

  if (typeof raw === "string") {
    jsonText = raw.trim();
    if (!jsonText) return null;
    try {
      JSON.parse(jsonText);
    } catch {
      throw new PublicHttpException(400, {
        error: "invalid_params",
        field: "last_check_result_json",
      });
    }
  } else {
    try {
      jsonText = JSON.stringify(raw);
    } catch {
      throw new PublicHttpException(400, {
        error: "invalid_params",
        field: "last_check_result_json",
      });
    }

    if (!jsonText) {
      throw new PublicHttpException(400, {
        error: "invalid_params",
        field: "last_check_result_json",
      });
    }
  }

  if (jsonText.length > MAX_TEXT_LENGTH) {
    throw new PublicHttpException(400, {
      error: "invalid_params",
      field: "last_check_result_json",
    });
  }

  return jsonText;
}

function parseJsonText(raw: string | null): unknown {
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function toAdminDnsRequest(row: AdminDnsRequestRow | null): Record<string, unknown> | null {
  if (!row) return null;

  return {
    ...row,
    last_check_result_json: parseJsonText(row.last_check_result_json),
  };
}

@Injectable()
export class AdminDnsRequestsService {
  constructor(private readonly adminDnsRequestsRepository: AdminDnsRequestsRepository) {}

  async listDnsRequests(query: AdminDnsRequestsListQueryDto): Promise<{
    items: Array<Record<string, unknown> | null>;
    pagination: { total: number; limit: number; offset: number };
  }> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const [rows, total] = await Promise.all([
      this.adminDnsRequestsRepository.listAll({
        limit,
        offset,
        target: query.target,
        type: query.type,
        status: query.status,
      }),
      this.adminDnsRequestsRepository.countAll({
        target: query.target,
        type: query.type,
        status: query.status,
      }),
    ]);

    return {
      items: rows.map((row) => toAdminDnsRequest(row)),
      pagination: { total, limit, offset },
    };
  }

  async getDnsRequestById(idRaw: unknown): Promise<{ item: Record<string, unknown> | null }> {
    const id = parsePositiveInt(idRaw);
    if (!id) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "id" });
    }

    const row = await this.adminDnsRequestsRepository.getById(id);
    if (!row) {
      throw new PublicHttpException(404, { error: "dns_request_not_found", id });
    }

    return { item: toAdminDnsRequest(row) };
  }

  async createDnsRequest(dto: AdminCreateDnsRequestDto): Promise<{
    ok: true;
    created: true;
    item: Record<string, unknown> | null;
  }> {
    const target = normalizeDnsTarget(dto.target);
    const type = normalizeDnsRequestType(dto.type);
    const status = normalizeDnsRequestStatus(dto.status);

    const existing = await this.adminDnsRequestsRepository.getByTargetType(target, type);
    if (existing) {
      throw new PublicHttpException(409, { error: "dns_request_taken", target, type });
    }

    try {
      const created = await this.adminDnsRequestsRepository.createDnsRequest({
        target,
        type,
        status,
        activatedAt: dto.activated_at ?? null,
        lastCheckedAt: dto.last_checked_at ?? null,
        nextCheckAt: dto.next_check_at ?? null,
        lastCheckResultJson: normalizeOptionalJsonText(dto.last_check_result_json) ?? null,
        failReason: normalizeOptionalText(dto.fail_reason, "fail_reason") ?? null,
        expiresAt: dto.expires_at,
      });
      const row = created.insertId
        ? await this.adminDnsRequestsRepository.getById(created.insertId)
        : null;

      return {
        ok: true,
        created: true,
        item: toAdminDnsRequest(row),
      };
    } catch (error) {
      if (this.isDuplicateEntry(error)) {
        throw new PublicHttpException(409, { error: "dns_request_taken", target, type });
      }
      throw error;
    }
  }

  async updateDnsRequest(
    idRaw: unknown,
    dto: AdminUpdateDnsRequestDto,
  ): Promise<{ ok: true; updated: true; item: Record<string, unknown> | null }> {
    const id = parsePositiveInt(idRaw);
    if (!id) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "id" });
    }

    const current = await this.adminDnsRequestsRepository.getById(id);
    if (!current) {
      throw new PublicHttpException(404, { error: "dns_request_not_found", id });
    }

    const patch: {
      target?: string;
      type?: string;
      status?: string;
      activatedAt?: Date | null;
      lastCheckedAt?: Date | null;
      nextCheckAt?: Date | null;
      lastCheckResultJson?: string | null;
      failReason?: string | null;
      expiresAt?: Date;
    } = {};

    const nextTarget = dto.target !== undefined ? normalizeDnsTarget(dto.target) : current.target;
    const nextType = dto.type !== undefined ? normalizeDnsRequestType(dto.type) : current.type;

    if (dto.target !== undefined) {
      patch.target = nextTarget;
    }
    if (dto.type !== undefined) {
      patch.type = nextType;
    }
    if (dto.status !== undefined) {
      patch.status = normalizeDnsRequestStatus(dto.status);
    }
    if (dto.activated_at !== undefined) {
      patch.activatedAt = dto.activated_at ?? null;
    }
    if (dto.last_checked_at !== undefined) {
      patch.lastCheckedAt = dto.last_checked_at ?? null;
    }
    if (dto.next_check_at !== undefined) {
      patch.nextCheckAt = dto.next_check_at ?? null;
    }
    if (dto.last_check_result_json !== undefined) {
      patch.lastCheckResultJson = normalizeOptionalJsonText(dto.last_check_result_json) ?? null;
    }
    if (dto.fail_reason !== undefined) {
      patch.failReason = normalizeOptionalText(dto.fail_reason, "fail_reason") ?? null;
    }
    if (dto.expires_at !== undefined) {
      patch.expiresAt = dto.expires_at;
    }

    if (nextTarget !== current.target || nextType !== current.type) {
      const conflict = await this.adminDnsRequestsRepository.getByTargetType(nextTarget, nextType);
      if (conflict && Number(conflict.id) !== id) {
        throw new PublicHttpException(409, {
          error: "dns_request_taken",
          target: nextTarget,
          type: nextType,
        });
      }
    }

    if (Object.keys(patch).length === 0) {
      throw new PublicHttpException(400, {
        error: "invalid_params",
        reason: "empty_patch",
      });
    }

    try {
      await this.adminDnsRequestsRepository.updateById(id, patch);
      const row = await this.adminDnsRequestsRepository.getById(id);

      return {
        ok: true,
        updated: true,
        item: toAdminDnsRequest(row),
      };
    } catch (error) {
      if (this.isDuplicateEntry(error)) {
        throw new PublicHttpException(409, {
          error: "dns_request_taken",
          target: nextTarget,
          type: nextType,
        });
      }
      throw error;
    }
  }

  async deleteDnsRequest(idRaw: unknown): Promise<{
    ok: true;
    deleted: boolean;
    item: Record<string, unknown> | null;
  }> {
    const id = parsePositiveInt(idRaw);
    if (!id) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "id" });
    }

    const current = await this.adminDnsRequestsRepository.getById(id);
    if (!current) {
      throw new PublicHttpException(404, { error: "dns_request_not_found", id });
    }

    const deleted = await this.adminDnsRequestsRepository.deleteById(id);

    return {
      ok: true,
      deleted: Boolean(deleted),
      item: toAdminDnsRequest(current),
    };
  }

  private isDuplicateEntry(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ER_DUP_ENTRY"
    );
  }
}
