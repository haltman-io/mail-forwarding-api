import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { DatabaseService } from "../../../shared/database/database.service.js";
import { isDuplicateEntry } from "../../../shared/database/database.utils.js";
import { PublicHttpException } from "../../../shared/errors/public-http.exception.js";
import { sha256Buffer } from "../../../shared/utils/crypto.js";
import {
  isConfirmationCodeValid,
  normalizeConfirmationCode,
} from "../../../shared/utils/confirmation-code.js";
import {
  normalizeLowerTrim,
  isValidLocalPart,
  isValidDomain,
  parseMailbox,
} from "../../../shared/validation/mailbox.js";
import { BanPolicyService } from "../../bans/ban-policy.service.js";
import { DomainRepository } from "../../domains/domain.repository.js";
import { AliasRepository } from "../../api/repositories/alias.repository.js";
import { EmailConfirmationsRepository } from "../../forwarding/repositories/email-confirmations.repository.js";
import { EmailConfirmationService } from "../../forwarding/services/email-confirmation.service.js";
import { HandleRepository } from "../repositories/handle.repository.js";
import { HandleDisabledDomainRepository } from "../repositories/handle-disabled-domain.repository.js";

const HANDLE_DOMAIN_SENTINEL = "__handle__";

@Injectable()
export class HandleService {
  constructor(
    private readonly handleRepository: HandleRepository,
    private readonly handleDisabledDomainRepository: HandleDisabledDomainRepository,
    private readonly aliasRepository: AliasRepository,
    private readonly domainRepository: DomainRepository,
    private readonly banPolicyService: BanPolicyService,
    private readonly emailConfirmationService: EmailConfirmationService,
    private readonly emailConfirmationsRepository: EmailConfirmationsRepository,
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
  ) {}

  async subscribe(params: {
    handleRaw: unknown;
    toRaw: unknown;
    ipText: string | undefined;
    userAgent: string;
    origin: string;
    referer: string;
  }): Promise<{ status: number; body: Record<string, unknown> }> {
    const handle = normalizeLowerTrim(params.handleRaw);
    if (!handle || !isValidLocalPart(handle)) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "handle" });
    }

    const to = parseMailbox(params.toRaw);
    if (!to) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "to" });
    }

    await this.checkBans(handle, to.email);

    const existsAsAlias = await this.aliasRepository.existsByAddress(to.email);
    if (existsAsAlias) {
      throw new PublicHttpException(400, {
        error: "invalid_params",
        field: "to",
        reason: "destination_cannot_be_an_existing_alias",
      });
    }

    const managedDomain = await this.domainRepository.getActiveByName(to.domain);
    if (managedDomain) {
      throw new PublicHttpException(400, {
        error: "invalid_params",
        field: "to",
        reason: "destination_cannot_use_managed_domain",
      });
    }

    const existsHandle = await this.handleRepository.existsByHandle(handle);
    if (existsHandle) {
      throw new PublicHttpException(409, { ok: false, error: "alias_taken" });
    }

    const existsAlias = await this.aliasRepository.existsByLocalPart(handle);
    if (existsAlias) {
      throw new PublicHttpException(409, { ok: false, error: "alias_taken" });
    }

    const confirmation = await this.emailConfirmationService.sendEmailConfirmation({
      email: to.email,
      requestIpText: params.ipText,
      userAgent: params.userAgent,
      aliasName: handle,
      aliasDomain: HANDLE_DOMAIN_SENTINEL,
      aliasDisplay: handle,
      intent: "handle_subscribe",
      requestOrigin: params.origin,
      requestReferer: params.referer,
    });

    return {
      status: 200,
      body: {
        ok: true,
        action: "handle_subscribe",
        handle,
        to: to.email,
        confirmation: {
          sent: confirmation.sent,
          ttl_minutes: confirmation.ttl_minutes,
          ...(confirmation.reason ? { reason: confirmation.reason } : {}),
        },
      },
    };
  }

  async unsubscribe(params: {
    handleRaw: unknown;
    ipText: string | undefined;
    userAgent: string;
    origin: string;
    referer: string;
  }): Promise<{ status: number; body: Record<string, unknown> }> {
    const handle = normalizeLowerTrim(params.handleRaw);
    if (!handle || !isValidLocalPart(handle)) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "handle" });
    }

    const row = await this.handleRepository.getActiveByHandle(handle);
    if (!row || !row.address) {
      return { status: 200, body: { ok: true, accepted: true } };
    }

    const confirmation = await this.emailConfirmationService.sendEmailConfirmation({
      email: row.address,
      requestIpText: params.ipText,
      userAgent: params.userAgent,
      aliasName: handle,
      aliasDomain: HANDLE_DOMAIN_SENTINEL,
      aliasDisplay: handle,
      intent: "handle_unsubscribe",
      requestOrigin: params.origin,
      requestReferer: params.referer,
    });

    return {
      status: 200,
      body: {
        ok: true,
        action: "handle_unsubscribe",
        handle,
        confirmation: {
          sent: confirmation.sent,
          ttl_minutes: confirmation.ttl_minutes,
          ...(confirmation.reason ? { reason: confirmation.reason } : {}),
        },
      },
    };
  }

  async domainDisable(params: {
    handleRaw: unknown;
    domainRaw: unknown;
    ipText: string | undefined;
    userAgent: string;
    origin: string;
    referer: string;
  }): Promise<{ status: number; body: Record<string, unknown> }> {
    const handle = normalizeLowerTrim(params.handleRaw);
    if (!handle || !isValidLocalPart(handle)) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "handle" });
    }

    const domain = normalizeLowerTrim(params.domainRaw);
    if (!domain || !isValidDomain(domain)) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "domain" });
    }

    const row = await this.handleRepository.getActiveByHandle(handle);
    if (!row || !row.address) {
      return { status: 200, body: { ok: true, accepted: true } };
    }

    const confirmation = await this.emailConfirmationService.sendEmailConfirmation({
      email: row.address,
      requestIpText: params.ipText,
      userAgent: params.userAgent,
      aliasName: handle,
      aliasDomain: domain,
      aliasDisplay: `${handle} @ ${domain}`,
      intent: "handle_domain_disable",
      requestOrigin: params.origin,
      requestReferer: params.referer,
    });

    return {
      status: 200,
      body: {
        ok: true,
        action: "handle_disable_domain",
        handle,
        domain,
        confirmation: {
          sent: confirmation.sent,
          ttl_minutes: confirmation.ttl_minutes,
          ...(confirmation.reason ? { reason: confirmation.reason } : {}),
        },
      },
    };
  }

  async domainEnable(params: {
    handleRaw: unknown;
    domainRaw: unknown;
    ipText: string | undefined;
    userAgent: string;
    origin: string;
    referer: string;
  }): Promise<{ status: number; body: Record<string, unknown> }> {
    const handle = normalizeLowerTrim(params.handleRaw);
    if (!handle || !isValidLocalPart(handle)) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "handle" });
    }

    const domain = normalizeLowerTrim(params.domainRaw);
    if (!domain || !isValidDomain(domain)) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "domain" });
    }

    const row = await this.handleRepository.getActiveByHandle(handle);
    if (!row || !row.address) {
      return { status: 200, body: { ok: true, accepted: true } };
    }

    const confirmation = await this.emailConfirmationService.sendEmailConfirmation({
      email: row.address,
      requestIpText: params.ipText,
      userAgent: params.userAgent,
      aliasName: handle,
      aliasDomain: domain,
      aliasDisplay: `${handle} @ ${domain}`,
      intent: "handle_domain_enable",
      requestOrigin: params.origin,
      requestReferer: params.referer,
    });

    return {
      status: 200,
      body: {
        ok: true,
        action: "handle_enable_domain",
        handle,
        domain,
        confirmation: {
          sent: confirmation.sent,
          ttl_minutes: confirmation.ttl_minutes,
          ...(confirmation.reason ? { reason: confirmation.reason } : {}),
        },
      },
    };
  }

  async confirmAction(tokenRaw: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
    const token = normalizeConfirmationCode(tokenRaw);
    if (!token) {
      throw new PublicHttpException(400, { ok: false, error: "invalid_params", field: "token" });
    }

    if (!isConfirmationCodeValid(token)) {
      throw new PublicHttpException(400, { ok: false, error: "invalid_token" });
    }

    const tokenHash32 = sha256Buffer(token);
    const pending = await this.emailConfirmationsRepository.getPendingByTokenHash(tokenHash32);

    if (!pending) {
      throw new PublicHttpException(400, { ok: false, error: "invalid_or_expired" });
    }

    const intent = String(pending.intent || "").trim().toLowerCase();
    const aliasName = String(pending.alias_name || "").trim().toLowerCase();

    if (!aliasName) {
      throw new PublicHttpException(500, { ok: false, error: "confirmation_payload_missing" });
    }

    switch (intent) {
      case "handle_subscribe":
        return this.confirmSubscribe(tokenHash32, pending);
      case "handle_unsubscribe":
        return this.confirmUnsubscribe(tokenHash32, pending);
      case "handle_domain_disable":
        return this.confirmDomainDisable(tokenHash32, pending);
      case "handle_domain_enable":
        return this.confirmDomainEnable(tokenHash32, pending);
      default:
        throw new PublicHttpException(400, { ok: false, error: "unsupported_intent", intent });
    }
  }

  private async confirmSubscribe(
    tokenHash32: Buffer,
    pending: { id: number; email: string; alias_name: string },
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const handle = String(pending.alias_name).trim().toLowerCase();
    const toEmail = String(pending.email).trim().toLowerCase();

    return this.databaseService.withTransaction(async (connection) => {
      const lockedPending = await this.emailConfirmationsRepository.getPendingByTokenHash(
        tokenHash32,
        connection,
        { forUpdate: true },
      );
      if (!lockedPending) {
        return { status: 400, body: { ok: false, error: "invalid_or_expired" } };
      }

      const existsHandle = await this.handleRepository.existsByHandle(handle, connection);
      if (existsHandle) {
        return { status: 409, body: { ok: false, error: "alias_taken" } };
      }

      const existsAlias = await this.aliasRepository.existsByLocalPart(handle, connection);
      if (existsAlias) {
        return { status: 409, body: { ok: false, error: "alias_taken" } };
      }

      const banName = await this.banPolicyService.findActiveNameBan(handle);
      if (banName) {
        return { status: 403, body: { error: "banned", ban: banName } };
      }

      const banEmail = await this.banPolicyService.findActiveEmailOrDomainBan(toEmail);
      if (banEmail) {
        return { status: 403, body: { error: "banned", ban: banEmail } };
      }

      try {
        await this.handleRepository.createHandle(
          { handle, address: toEmail, active: 1 },
          connection,
        );
      } catch (error) {
        if (isDuplicateEntry(error)) {
          return { status: 409, body: { ok: false, error: "alias_taken" } };
        }
        throw error;
      }

      await this.emailConfirmationsRepository.markConfirmedById(lockedPending.id, connection);

      return {
        status: 200,
        body: { ok: true, created: true, handle, goto: toEmail },
      };
    });
  }

  private async confirmUnsubscribe(
    tokenHash32: Buffer,
    pending: { id: number; alias_name: string },
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const handle = String(pending.alias_name).trim().toLowerCase();

    return this.databaseService.withTransaction(async (connection) => {
      const lockedPending = await this.emailConfirmationsRepository.getPendingByTokenHash(
        tokenHash32,
        connection,
        { forUpdate: true },
      );
      if (!lockedPending) {
        return { status: 400, body: { ok: false, error: "invalid_or_expired" } };
      }

      const row = await this.handleRepository.getActiveByHandle(handle, connection, {
        forUpdate: true,
      });
      if (!row) {
        return { status: 404, body: { ok: false, error: "handle_not_found" } };
      }

      await this.handleRepository.unsubscribe(handle, connection);
      await this.emailConfirmationsRepository.markConfirmedById(lockedPending.id, connection);

      return {
        status: 200,
        body: { ok: true, updated: true, handle, active: false },
      };
    });
  }

  private async confirmDomainDisable(
    tokenHash32: Buffer,
    pending: { id: number; alias_name: string; alias_domain: string },
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const handle = String(pending.alias_name).trim().toLowerCase();
    const domain = String(pending.alias_domain).trim().toLowerCase();

    return this.databaseService.withTransaction(async (connection) => {
      const lockedPending = await this.emailConfirmationsRepository.getPendingByTokenHash(
        tokenHash32,
        connection,
        { forUpdate: true },
      );
      if (!lockedPending) {
        return { status: 400, body: { ok: false, error: "invalid_or_expired" } };
      }

      const row = await this.handleRepository.getActiveByHandle(handle, connection, {
        forUpdate: true,
      });
      if (!row) {
        return { status: 404, body: { ok: false, error: "handle_not_found" } };
      }

      await this.handleDisabledDomainRepository.disableDomain(row.id, domain, connection);
      await this.emailConfirmationsRepository.markConfirmedById(lockedPending.id, connection);

      return {
        status: 200,
        body: { ok: true, updated: true, handle, domain, disabled: true },
      };
    });
  }

  private async confirmDomainEnable(
    tokenHash32: Buffer,
    pending: { id: number; alias_name: string; alias_domain: string },
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const handle = String(pending.alias_name).trim().toLowerCase();
    const domain = String(pending.alias_domain).trim().toLowerCase();

    return this.databaseService.withTransaction(async (connection) => {
      const lockedPending = await this.emailConfirmationsRepository.getPendingByTokenHash(
        tokenHash32,
        connection,
        { forUpdate: true },
      );
      if (!lockedPending) {
        return { status: 400, body: { ok: false, error: "invalid_or_expired" } };
      }

      const row = await this.handleRepository.getActiveByHandle(handle, connection, {
        forUpdate: true,
      });
      if (!row) {
        return { status: 404, body: { ok: false, error: "handle_not_found" } };
      }

      await this.handleDisabledDomainRepository.enableDomain(row.id, domain, connection);
      await this.emailConfirmationsRepository.markConfirmedById(lockedPending.id, connection);

      return {
        status: 200,
        body: { ok: true, updated: true, handle, domain, disabled: false },
      };
    });
  }

  private async checkBans(handle: string, destinationEmail: string): Promise<void> {
    const banName = await this.banPolicyService.findActiveNameBan(handle);
    if (banName) {
      throw new PublicHttpException(403, { error: "banned", ban: banName });
    }

    const banEmail = await this.banPolicyService.findActiveEmailOrDomainBan(destinationEmail);
    if (banEmail) {
      throw new PublicHttpException(403, { error: "banned", ban: banEmail });
    }
  }
}
