import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../../../shared/database/database.service.js";
import { PublicHttpException } from "../../../shared/errors/public-http.exception.js";
import { PgpKeyService, type ValidatedPgpPublicKey } from "../../../shared/pgp/pgp-key.service.js";
import { parseMailbox } from "../../../shared/validation/mailbox.js";
import { AliasRepository, type AliasRow } from "../repositories/alias.repository.js";

type PgpSettings = {
  publicKey: string | null;
  fingerprint: string | null;
  enabled: boolean;
  hideSubject: boolean;
};

type AliasPgpResponse = {
  ok: true;
  alias: string;
  pgp: {
    configured: boolean;
    enabled: boolean;
    hide_subject: boolean;
    fingerprint: string | null;
    public_key: string | null;
  };
};

@Injectable()
export class AliasPgpService {
  constructor(
    private readonly aliasRepository: AliasRepository,
    private readonly databaseService: DatabaseService,
    private readonly pgpKeyService: PgpKeyService,
  ) {}

  async getPgp(params: {
    ownerEmail: string;
    alias: unknown;
  }): Promise<AliasPgpResponse> {
    const alias = this.normalizeAlias(params.alias);
    const ownerEmail = this.normalizeOwnerEmail(params.ownerEmail);
    const row = this.assertAliasOwnedBy(
      await this.aliasRepository.getByAddress(alias),
      ownerEmail,
      alias,
    );

    return this.toResponse(alias, this.settingsFromRow(row));
  }

  async setPgp(params: {
    ownerEmail: string;
    alias: unknown;
    publicKey: unknown;
    enabled?: boolean | undefined;
    hideSubject?: boolean | undefined;
  }): Promise<AliasPgpResponse & { updated: true }> {
    const alias = this.normalizeAlias(params.alias);
    const ownerEmail = this.normalizeOwnerEmail(params.ownerEmail);
    const validated = await this.pgpKeyService.validatePublicKey(params.publicKey);
    const nextSettings: PgpSettings = {
      publicKey: validated.publicKey,
      fingerprint: validated.fingerprint,
      enabled: params.enabled ?? true,
      hideSubject: params.hideSubject ?? false,
    };

    await this.databaseService.withTransaction(async (connection) => {
      const row = this.assertAliasOwnedBy(
        await this.aliasRepository.getByAddress(alias, connection, { forUpdate: true }),
        ownerEmail,
        alias,
      );
      await this.aliasRepository.updatePgpById(row.id, nextSettings, connection);
    });

    return { ...this.toResponse(alias, nextSettings), updated: true };
  }

  async patchPgp(params: {
    ownerEmail: string;
    alias: unknown;
    publicKey?: unknown;
    enabled?: boolean | undefined;
    hideSubject?: boolean | undefined;
  }): Promise<AliasPgpResponse & { updated: true }> {
    const hasPublicKey = params.publicKey !== undefined;
    const hasEnabled = params.enabled !== undefined;
    const hasHideSubject = params.hideSubject !== undefined;
    if (!hasPublicKey && !hasEnabled && !hasHideSubject) {
      throw new PublicHttpException(400, {
        error: "invalid_params",
        field: "body",
        reason: "empty_patch",
      });
    }

    const alias = this.normalizeAlias(params.alias);
    const ownerEmail = this.normalizeOwnerEmail(params.ownerEmail);
    const validated = hasPublicKey
      ? await this.pgpKeyService.validatePublicKey(params.publicKey)
      : null;

    const nextSettings = await this.databaseService.withTransaction(async (connection) => {
      const row = this.assertAliasOwnedBy(
        await this.aliasRepository.getByAddress(alias, connection, { forUpdate: true }),
        ownerEmail,
        alias,
      );
      const next = this.mergePatch(this.settingsFromRow(row), validated, {
        enabled: params.enabled,
        hideSubject: params.hideSubject,
      });

      await this.aliasRepository.updatePgpById(row.id, next, connection);
      return next;
    });

    return { ...this.toResponse(alias, nextSettings), updated: true };
  }

  async deletePgp(params: {
    ownerEmail: string;
    alias: unknown;
  }): Promise<AliasPgpResponse & { updated: true }> {
    const alias = this.normalizeAlias(params.alias);
    const ownerEmail = this.normalizeOwnerEmail(params.ownerEmail);

    await this.databaseService.withTransaction(async (connection) => {
      const row = this.assertAliasOwnedBy(
        await this.aliasRepository.getByAddress(alias, connection, { forUpdate: true }),
        ownerEmail,
        alias,
      );
      await this.aliasRepository.clearPgpById(row.id, connection);
    });

    return {
      ...this.toResponse(alias, {
        publicKey: null,
        fingerprint: null,
        enabled: false,
        hideSubject: false,
      }),
      updated: true,
    };
  }

  private mergePatch(
    current: PgpSettings,
    validated: ValidatedPgpPublicKey | null,
    patch: { enabled?: boolean | undefined; hideSubject?: boolean | undefined },
  ): PgpSettings {
    const next: PgpSettings = {
      publicKey: validated?.publicKey ?? current.publicKey,
      fingerprint: validated?.fingerprint ?? current.fingerprint,
      enabled: patch.enabled ?? current.enabled,
      hideSubject: patch.hideSubject ?? current.hideSubject,
    };

    if (next.enabled && !next.publicKey) {
      throw new PublicHttpException(400, {
        error: "invalid_params",
        field: "enabled",
        reason: "pgp_key_required",
      });
    }

    return next;
  }

  private normalizeAlias(raw: unknown): string {
    const parsed = parseMailbox(raw);
    if (!parsed) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "alias" });
    }
    return parsed.email;
  }

  private normalizeOwnerEmail(raw: string): string {
    const parsed = parseMailbox(raw);
    if (!parsed) {
      throw new PublicHttpException(401, { error: "invalid_api_key_owner" });
    }
    return parsed.email;
  }

  private assertAliasOwnedBy(
    row: AliasRow | null,
    ownerEmail: string,
    alias: string,
  ): AliasRow {
    if (!row) {
      throw new PublicHttpException(404, { error: "alias_not_found", alias });
    }

    if (Number(row.active) !== 1) {
      throw new PublicHttpException(400, { error: "alias_inactive", alias });
    }

    const goto = String(row.goto || "").trim().toLowerCase();
    if (goto !== ownerEmail) {
      throw new PublicHttpException(403, { error: "forbidden" });
    }

    return row;
  }

  private settingsFromRow(row: AliasRow): PgpSettings {
    return {
      publicKey: row.pgp_public_key ?? null,
      fingerprint: row.pgp_fingerprint ?? null,
      enabled: Number(row.pgp_enabled ?? 0) === 1,
      hideSubject: Number(row.pgp_hide_subject ?? 0) === 1,
    };
  }

  private toResponse(alias: string, settings: PgpSettings): AliasPgpResponse {
    return {
      ok: true,
      alias,
      pgp: {
        configured: Boolean(settings.publicKey),
        enabled: settings.enabled,
        hide_subject: settings.hideSubject,
        fingerprint: settings.fingerprint,
        public_key: settings.publicKey,
      },
    };
  }
}
