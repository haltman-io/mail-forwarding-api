import { Injectable } from "@nestjs/common";

import { DatabaseService } from "../../../shared/database/database.service.js";
import { PublicHttpException } from "../../../shared/errors/public-http.exception.js";
import { PgpKeyService, type ValidatedPgpPublicKey } from "../../../shared/pgp/pgp-key.service.js";
import {
  isValidLocalPart,
  normalizeLowerTrim,
  parseMailbox,
} from "../../../shared/validation/mailbox.js";
import { HandleRepository, type HandleRow } from "../repositories/handle.repository.js";

type PgpSettings = {
  publicKey: string | null;
  fingerprint: string | null;
  enabled: boolean;
  hideSubject: boolean;
};

type HandlePgpResponse = {
  ok: true;
  handle: string;
  pgp: {
    configured: boolean;
    enabled: boolean;
    hide_subject: boolean;
    fingerprint: string | null;
    public_key: string | null;
  };
};

@Injectable()
export class HandlePgpService {
  constructor(
    private readonly handleRepository: HandleRepository,
    private readonly databaseService: DatabaseService,
    private readonly pgpKeyService: PgpKeyService,
  ) {}

  async getPgp(params: {
    ownerEmail: string;
    handle: unknown;
  }): Promise<HandlePgpResponse> {
    const handle = this.normalizeHandle(params.handle);
    const ownerEmail = this.normalizeOwnerEmail(params.ownerEmail);
    const row = this.assertHandleOwnedBy(
      await this.handleRepository.getActiveByHandle(handle),
      ownerEmail,
    );

    return this.toResponse(handle, this.settingsFromRow(row));
  }

  async setPgp(params: {
    ownerEmail: string;
    handle: unknown;
    publicKey: unknown;
    enabled?: boolean | undefined;
    hideSubject?: boolean | undefined;
  }): Promise<HandlePgpResponse & { updated: true }> {
    const handle = this.normalizeHandle(params.handle);
    const ownerEmail = this.normalizeOwnerEmail(params.ownerEmail);
    const validated = await this.pgpKeyService.validatePublicKey(params.publicKey);
    const nextSettings: PgpSettings = {
      publicKey: validated.publicKey,
      fingerprint: validated.fingerprint,
      enabled: params.enabled ?? true,
      hideSubject: params.hideSubject ?? false,
    };

    await this.databaseService.withTransaction(async (connection) => {
      const row = this.assertHandleOwnedBy(
        await this.handleRepository.getActiveByHandle(handle, connection, { forUpdate: true }),
        ownerEmail,
      );
      await this.handleRepository.updatePgpById(row.id, nextSettings, connection);
    });

    return { ...this.toResponse(handle, nextSettings), updated: true };
  }

  async patchPgp(params: {
    ownerEmail: string;
    handle: unknown;
    publicKey?: unknown;
    enabled?: boolean | undefined;
    hideSubject?: boolean | undefined;
  }): Promise<HandlePgpResponse & { updated: true }> {
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

    const handle = this.normalizeHandle(params.handle);
    const ownerEmail = this.normalizeOwnerEmail(params.ownerEmail);
    const validated = hasPublicKey
      ? await this.pgpKeyService.validatePublicKey(params.publicKey)
      : null;

    const nextSettings = await this.databaseService.withTransaction(async (connection) => {
      const row = this.assertHandleOwnedBy(
        await this.handleRepository.getActiveByHandle(handle, connection, { forUpdate: true }),
        ownerEmail,
      );
      const next = this.mergePatch(this.settingsFromRow(row), validated, {
        enabled: params.enabled,
        hideSubject: params.hideSubject,
      });

      await this.handleRepository.updatePgpById(row.id, next, connection);
      return next;
    });

    return { ...this.toResponse(handle, nextSettings), updated: true };
  }

  async deletePgp(params: {
    ownerEmail: string;
    handle: unknown;
  }): Promise<HandlePgpResponse & { updated: true }> {
    const handle = this.normalizeHandle(params.handle);
    const ownerEmail = this.normalizeOwnerEmail(params.ownerEmail);

    await this.databaseService.withTransaction(async (connection) => {
      const row = this.assertHandleOwnedBy(
        await this.handleRepository.getActiveByHandle(handle, connection, { forUpdate: true }),
        ownerEmail,
      );
      await this.handleRepository.clearPgpById(row.id, connection);
    });

    return {
      ...this.toResponse(handle, {
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

  private normalizeHandle(raw: unknown): string {
    const handle = normalizeLowerTrim(raw);
    if (!handle || !isValidLocalPart(handle)) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "handle" });
    }
    return handle;
  }

  private normalizeOwnerEmail(raw: string): string {
    const parsed = parseMailbox(raw);
    if (!parsed) {
      throw new PublicHttpException(401, { error: "invalid_api_key_owner" });
    }
    return parsed.email;
  }

  private assertHandleOwnedBy(row: HandleRow | null, ownerEmail: string): HandleRow {
    if (!row) {
      throw new PublicHttpException(404, { error: "handle_not_found" });
    }

    const rowAddress = String(row.address || "").trim().toLowerCase();
    if (rowAddress !== ownerEmail) {
      throw new PublicHttpException(403, { error: "forbidden" });
    }

    return row;
  }

  private settingsFromRow(row: HandleRow): PgpSettings {
    return {
      publicKey: row.pgp_public_key ?? null,
      fingerprint: row.pgp_fingerprint ?? null,
      enabled: Number(row.pgp_enabled ?? 0) === 1,
      hideSubject: Number(row.pgp_hide_subject ?? 0) === 1,
    };
  }

  private toResponse(handle: string, settings: PgpSettings): HandlePgpResponse {
    return {
      ok: true,
      handle,
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
