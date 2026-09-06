import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../../../shared/database/database.service.js";
import { isDuplicateEntry } from "../../../shared/database/database.utils.js";
import { PublicHttpException } from "../../../shared/errors/public-http.exception.js";
import {
  normalizeLowerTrim,
  isValidLocalPart,
  isValidDomain,
  parseMailbox,
} from "../../../shared/validation/mailbox.js";
import { BanPolicyService } from "../../bans/ban-policy.service.js";
import { AliasRepository, type AliasRow } from "../../api/repositories/alias.repository.js";
import { HandleRepository } from "../repositories/handle.repository.js";
import { HandleDisabledDomainRepository } from "../repositories/handle-disabled-domain.repository.js";

@Injectable()
export class HandleApiService {
  constructor(
    private readonly handleRepository: HandleRepository,
    private readonly handleDisabledDomainRepository: HandleDisabledDomainRepository,
    private readonly aliasRepository: AliasRepository,
    private readonly banPolicyService: BanPolicyService,
    private readonly databaseService: DatabaseService,
  ) {}

  async createHandle(params: {
    ownerEmail: string;
    handle: unknown;
  }): Promise<{
    ok: true;
    created: true;
    handle: string;
    goto: string;
    converted_aliases?: string[];
  }> {
    const handle = normalizeLowerTrim(params.handle);
    if (!handle || !isValidLocalPart(handle)) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "handle" });
    }

    const ownerEmail = this.normalizeOwnerEmail(params.ownerEmail);

    const banName = await this.banPolicyService.findActiveNameBan(handle);
    if (banName) {
      throw new PublicHttpException(403, { error: "banned", ban: banName });
    }

    const banOwner = await this.banPolicyService.findActiveEmailOrDomainBan(ownerEmail);
    if (banOwner) {
      throw new PublicHttpException(403, { error: "banned", ban: banOwner });
    }

    let convertedAliases: string[] = [];

    try {
      await this.databaseService.withTransaction(async (connection) => {
        const locked = await this.handleRepository.existsByHandle(handle, connection, {
          forUpdate: true,
        });
        if (locked) {
          throw new PublicHttpException(409, { ok: false, error: "alias_taken" });
        }

        const lockedAliases = await this.aliasRepository.findActiveByLocalPart(handle, connection, {
          forUpdate: true,
        });
        this.assertAliasesOwnedBy(lockedAliases, ownerEmail);

        await this.handleRepository.createHandle(
          { handle, address: ownerEmail, active: 1 },
          connection,
        );

        if (lockedAliases.length > 0) {
          const lockedAliasIds = lockedAliases.map((row) => row.id);
          const deleted = await this.aliasRepository.deleteActiveByIdsAndOwner(
            lockedAliasIds,
            ownerEmail,
            connection,
          );
          this.assertConvertedAliasCount(deleted, lockedAliasIds.length);
          convertedAliases = lockedAliases.map((row) => row.address);
        }
      });
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw new PublicHttpException(409, { ok: false, error: "alias_taken" });
      }
      throw error;
    }

    return {
      ok: true,
      created: true,
      handle,
      goto: ownerEmail,
      ...(convertedAliases.length > 0 ? { converted_aliases: convertedAliases } : {}),
    };
  }

  async deleteHandle(params: {
    ownerEmail: string;
    handle: unknown;
  }): Promise<{ ok: true; updated: true; handle: string; active: false }> {
    const handle = normalizeLowerTrim(params.handle);
    if (!handle || !isValidLocalPart(handle)) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "handle" });
    }

    const ownerEmail = this.normalizeOwnerEmail(params.ownerEmail);

    await this.databaseService.withTransaction(async (connection) => {
      const row = await this.handleRepository.getActiveByHandle(handle, connection, {
        forUpdate: true,
      });
      if (!row) {
        throw new PublicHttpException(404, { error: "handle_not_found" });
      }

      const rowAddress = String(row.address || "").trim().toLowerCase();
      if (rowAddress !== ownerEmail) {
        throw new PublicHttpException(403, { error: "forbidden" });
      }

      await this.handleRepository.unsubscribe(handle, connection);
    });

    return { ok: true, updated: true, handle, active: false };
  }

  async disableDomain(params: {
    ownerEmail: string;
    handle: unknown;
    domain: unknown;
  }): Promise<{ ok: true; updated: true; handle: string; domain: string; disabled: true }> {
    const handle = normalizeLowerTrim(params.handle);
    if (!handle || !isValidLocalPart(handle)) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "handle" });
    }

    const ownerEmail = this.normalizeOwnerEmail(params.ownerEmail);

    const domain = normalizeLowerTrim(params.domain);
    if (!domain || !isValidDomain(domain)) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "domain" });
    }

    await this.databaseService.withTransaction(async (connection) => {
      const row = await this.handleRepository.getActiveByHandle(handle, connection, {
        forUpdate: true,
      });
      if (!row) {
        throw new PublicHttpException(404, { error: "handle_not_found" });
      }

      const rowAddress = String(row.address || "").trim().toLowerCase();
      if (rowAddress !== ownerEmail) {
        throw new PublicHttpException(403, { error: "forbidden" });
      }

      await this.handleDisabledDomainRepository.disableDomain(row.id, domain, connection);
    });

    return { ok: true, updated: true, handle, domain, disabled: true };
  }

  async enableDomain(params: {
    ownerEmail: string;
    handle: unknown;
    domain: unknown;
  }): Promise<{ ok: true; updated: true; handle: string; domain: string; disabled: false }> {
    const handle = normalizeLowerTrim(params.handle);
    if (!handle || !isValidLocalPart(handle)) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "handle" });
    }

    const ownerEmail = this.normalizeOwnerEmail(params.ownerEmail);

    const domain = normalizeLowerTrim(params.domain);
    if (!domain || !isValidDomain(domain)) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "domain" });
    }

    await this.databaseService.withTransaction(async (connection) => {
      const row = await this.handleRepository.getActiveByHandle(handle, connection, {
        forUpdate: true,
      });
      if (!row) {
        throw new PublicHttpException(404, { error: "handle_not_found" });
      }

      const rowAddress = String(row.address || "").trim().toLowerCase();
      if (rowAddress !== ownerEmail) {
        throw new PublicHttpException(403, { error: "forbidden" });
      }

      await this.handleDisabledDomainRepository.enableDomain(row.id, domain, connection);
    });

    return { ok: true, updated: true, handle, domain, disabled: false };
  }

  private normalizeOwnerEmail(raw: string): string {
    const parsed = parseMailbox(raw);
    if (!parsed) {
      throw new PublicHttpException(401, { error: "invalid_api_key_owner" });
    }
    return parsed.email;
  }

  private assertAliasesOwnedBy(rows: readonly AliasRow[], ownerEmail: string): void {
    const conflict = rows.some((row) => String(row.goto || "").trim().toLowerCase() !== ownerEmail);
    if (conflict) {
      throw new PublicHttpException(409, { ok: false, error: "alias_taken" });
    }
  }

  private assertConvertedAliasCount(deleted: number, expected: number): void {
    if (deleted !== expected) {
      throw new PublicHttpException(409, {
        ok: false,
        error: "alias_conversion_state_changed",
      });
    }
  }
}
