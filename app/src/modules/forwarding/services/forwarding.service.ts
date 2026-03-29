import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { DatabaseService } from "../../../shared/database/database.service.js";
import { PublicHttpException } from "../../../shared/errors/public-http.exception.js";
import { AppLogger } from "../../../shared/logging/app-logger.service.js";
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
  MAX_EMAIL_LENGTH,
} from "../../../shared/validation/mailbox.js";
import { BanPolicyService } from "../../bans/ban-policy.service.js";
import { DomainRepository } from "../../domains/domain.repository.js";
import { AliasRepository } from "../../api/repositories/alias.repository.js";
import { EmailConfirmationsRepository } from "../repositories/email-confirmations.repository.js";
import { EmailConfirmationService } from "./email-confirmation.service.js";

function domainSuffixes(domain: string): string[] {
  if (!domain || typeof domain !== "string") return [];
  const parts = domain.split(".").filter(Boolean);
  const result: string[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    result.push(parts.slice(i).join("."));
  }
  return result;
}

function parseEmailLoose(emailRaw: unknown): { email: string; local: string; domain: string } | null {
  const email = normalizeLowerTrim(emailRaw);
  if (!email || email.length > MAX_EMAIL_LENGTH) return null;
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1 || email.indexOf("@") !== at) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return { email, local, domain };
}

@Injectable()
export class ForwardingService {
  constructor(
    private readonly emailConfirmationService: EmailConfirmationService,
    private readonly emailConfirmationsRepository: EmailConfirmationsRepository,
    private readonly aliasRepository: AliasRepository,
    private readonly domainRepository: DomainRepository,
    private readonly banPolicyService: BanPolicyService,
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
    private readonly logger: AppLogger,
  ) {}

  async subscribe(params: {
    nameRaw: unknown;
    domainRaw: unknown;
    addressRaw: unknown;
    toRaw: string;
    ipText: string | undefined;
    userAgent: string;
    origin: string;
    referer: string;
  }): Promise<Record<string, unknown>> {
    const addressProvided = params.addressRaw !== undefined;

    if (addressProvided) {
      if (params.nameRaw !== undefined) {
        throw new PublicHttpException(400, {
          error: "invalid_params",
          field: "name",
          reason: "address_incompatible_with_name",
        });
      }
      if (params.domainRaw !== undefined) {
        throw new PublicHttpException(400, {
          error: "invalid_params",
          field: "domain",
          reason: "address_incompatible_with_domain",
        });
      }
    }

    if (!params.toRaw) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "to" });
    }

    const toParsed = parseMailbox(params.toRaw);
    if (!toParsed) {
      throw new PublicHttpException(400, {
        error: "invalid_params",
        field: "to",
        hint: "allowed local: RFC 5322 dot-atom; domain: strict DNS (RFC 1035); lowercase",
      });
    }

    let aliasName = "";
    let aliasDomain = "";
    let aliasAddress = "";
    let domainRow: { id: number; name: string; active: number } | null = null;
    let intent = "subscribe";

    if (addressProvided) {
      const addressParsed = parseMailbox(params.addressRaw);
      if (!addressParsed) {
        throw new PublicHttpException(400, {
          error: "invalid_params",
          field: "address",
          hint: "expected: valid email address (local: RFC 5322 dot-atom; domain: strict DNS RFC 1035)",
        });
      }

      aliasName = addressParsed.local;
      aliasDomain = addressParsed.domain;
      aliasAddress = addressParsed.email;
      intent = "subscribe_address";
    } else {
      const name = normalizeLowerTrim(params.nameRaw);
      const domainInput = normalizeLowerTrim(params.domainRaw);

      if (!name) {
        throw new PublicHttpException(400, { error: "invalid_params", field: "name" });
      }

      if (!isValidLocalPart(name)) {
        throw new PublicHttpException(400, {
          error: "invalid_params",
          field: "name",
          hint: "allowed: RFC 5322 dot-atom local-part; max 64",
        });
      }

      const apiCredentialsSettings = this.configService.getOrThrow<{ defaultAliasDomain: string }>("apiCredentials");
      const defaultDomain = normalizeLowerTrim(apiCredentialsSettings.defaultAliasDomain);
      const chosenDomain = domainInput || defaultDomain;

      if (!chosenDomain) {
        throw new PublicHttpException(500, {
          error: "server_misconfigured",
          field: "DEFAULT_ALIAS_DOMAIN",
        });
      }

      if (!isValidDomain(chosenDomain)) {
        const status = domainInput ? 400 : 500;
        throw new PublicHttpException(status, {
          error: domainInput ? "invalid_params" : "server_misconfigured",
          field: "domain",
          hint: "allowed: strict DNS domain (a-z 0-9 hyphen dot), TLD letters >=2",
        });
      }

      aliasName = name;
      aliasDomain = chosenDomain;
      aliasAddress = `${name}@${chosenDomain}`;
    }

    await this.checkBans(aliasName, aliasDomain, toParsed.email);

    if (!addressProvided) {
      domainRow = await this.domainRepository.getActiveByName(aliasDomain);
      if (!domainRow) {
        throw new PublicHttpException(400, {
          error: "invalid_domain",
          field: "domain",
          hint: "domain must exist in database and be active",
        });
      }
    }

    const taken = await this.aliasRepository.existsByAddress(aliasAddress);
    if (taken) {
      throw new PublicHttpException(409, {
        ok: false,
        error: "alias_taken",
        address: aliasAddress,
      });
    }

    const reservedHandle = await this.aliasRepository.existsReservedHandle(aliasName);
    if (reservedHandle) {
      throw new PublicHttpException(409, {
        ok: false,
        error: "alias_taken",
        address: aliasAddress,
      });
    }

    const toIsAlias = await this.aliasRepository.existsByAddress(toParsed.email);
    if (toIsAlias) {
      throw new PublicHttpException(400, {
        ok: false,
        error: "invalid_params",
        field: "to",
        reason: "destination_cannot_be_an_existing_alias",
        to: toParsed.email,
      });
    }

    for (const suffix of domainSuffixes(toParsed.domain)) {
      const isManaged = await this.domainRepository.getActiveByName(suffix);
      if (isManaged) {
        throw new PublicHttpException(400, {
          ok: false,
          error: "invalid_params",
          field: "to",
          reason: "destination_cannot_use_managed_domain",
          to: toParsed.email,
          managed_domain_match: suffix,
        });
      }
    }

    if (toParsed.email === aliasAddress) {
      throw new PublicHttpException(400, {
        ok: false,
        error: "invalid_params",
        field: "to",
        reason: "destination_cannot_be_the_same_as_alias",
        to: toParsed.email,
        alias: aliasAddress,
      });
    }

    const result = await this.emailConfirmationService.sendEmailConfirmation({
      email: toParsed.email,
      requestIpText: params.ipText,
      userAgent: params.userAgent,
      requestOrigin: params.origin,
      requestReferer: params.referer,
      aliasName,
      aliasDomain,
      intent,
    });

    const forwardingSettings = this.configService.getOrThrow<{ emailConfirmationTtlMinutes: number }>("forwarding");
    const ttlMinutes = Number(forwardingSettings.emailConfirmationTtlMinutes ?? 10);
    const ttl = Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes : 10;

    return {
      ok: true,
      action: "subscribe",
      alias_candidate: addressProvided ? aliasAddress : `${aliasName}@${domainRow!.name}`,
      to: toParsed.email,
      confirmation: {
        sent: Boolean(result.sent),
        ttl_minutes: ttl,
      },
    };
  }

  async unsubscribe(params: {
    aliasRaw: string;
    clientIp: string;
    ipText: string | undefined;
    userAgent: string;
    origin: string;
    referer: string;
  }): Promise<Record<string, unknown>> {
    const aliasParsed = parseEmailLoose(params.aliasRaw);
    if (!aliasParsed) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "alias" });
    }

    const aliasName = aliasParsed.local;
    const aliasDomain = aliasParsed.domain;

    if (!isValidLocalPart(aliasName)) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "alias_name" });
    }
    if (!isValidDomain(aliasDomain)) {
      throw new PublicHttpException(400, { error: "invalid_params", field: "alias_domain" });
    }

    if (params.clientIp) {
      const ipBan = await this.banPolicyService.findActiveIpBan(params.clientIp);
      if (ipBan) {
        throw new PublicHttpException(403, { error: "banned", type: "ip" });
      }
    }

    const address = `${aliasName}@${aliasDomain}`;
    const aliasRow = await this.aliasRepository.getByAddress(address);

    if (!aliasRow || !aliasRow.id) {
      throw new PublicHttpException(404, { error: "alias_not_found", alias: address });
    }

    if (aliasRow.active === 0) {
      throw new PublicHttpException(400, { error: "alias_inactive", alias: address });
    }

    const gotoEmail = String(aliasRow.goto || "").trim().toLowerCase();
    const gotoParsed = parseMailbox(gotoEmail);

    if (!gotoParsed) {
      throw new PublicHttpException(500, { error: "invalid_goto_on_alias", alias: address });
    }

    const gotoBan = await this.banPolicyService.findActiveEmailOrDomainBan(gotoParsed.email);
    if (gotoBan) {
      if (gotoBan.ban_type === "email") {
        throw new PublicHttpException(403, { error: "banned", type: "email" });
      } else {
        throw new PublicHttpException(403, { error: "banned", type: "domain", value: gotoBan.ban_value });
      }
    }

    const result = await this.emailConfirmationService.sendEmailConfirmation({
      email: gotoParsed.email,
      requestIpText: params.ipText,
      userAgent: params.userAgent,
      requestOrigin: params.origin,
      requestReferer: params.referer,
      aliasName,
      aliasDomain,
      intent: "unsubscribe",
    });

    return {
      ok: true,
      action: "unsubscribe",
      alias: address,
      sent: Boolean(result.sent),
      reason: result.reason || undefined,
      ttl_minutes: result.ttl_minutes,
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

    const toEmail = String(pending.email || "").trim().toLowerCase();
    const intent = String(pending.intent || "subscribe").trim().toLowerCase();
    const aliasName = String(pending.alias_name || "").trim().toLowerCase();
    const aliasDomain = String(pending.alias_domain || "").trim().toLowerCase();

    if (!toEmail || !aliasName || !aliasDomain) {
      throw new PublicHttpException(500, {
        ok: false,
        error: "confirmation_payload_missing",
      });
    }

    const address = `${aliasName}@${aliasDomain}`;

    if (intent === "unsubscribe") {
      return this.confirmUnsubscribe(tokenHash32, address, toEmail, intent);
    }

    const isAddressIntent = intent === "subscribe_address";
    if (intent !== "subscribe" && !isAddressIntent) {
      throw new PublicHttpException(400, { ok: false, error: "unsupported_intent", intent });
    }

    return this.confirmSubscribe(tokenHash32, address, toEmail, aliasName, aliasDomain, intent, isAddressIntent);
  }

  private async confirmUnsubscribe(
    tokenHash32: Buffer,
    address: string,
    toEmail: string,
    intent: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    return this.databaseService.withTransaction(async (connection) => {
      const lockedPending = await this.emailConfirmationsRepository.getPendingByTokenHash(
        tokenHash32,
        connection,
        { forUpdate: true },
      );
      if (!lockedPending) {
        return { status: 400, body: { ok: false, error: "invalid_or_expired" } };
      }

      const row = await this.aliasRepository.getByAddress(address, connection, { forUpdate: true });
      if (!row || !row.id) {
        return { status: 404, body: { ok: false, error: "alias_not_found", address } };
      }

      if (Number(row.active) !== 1) {
        return { status: 400, body: { ok: false, error: "alias_inactive", alias: address } };
      }

      const currentGoto = String(row.goto || "").trim().toLowerCase();
      if (currentGoto && currentGoto !== toEmail) {
        return { status: 409, body: { ok: false, error: "alias_owner_changed", address } };
      }

      const deactivated = await this.aliasRepository.deactivateByAddress(address, connection);
      const confirmed = await this.emailConfirmationsRepository.markConfirmedById(
        lockedPending.id,
        connection,
      );
      if (!confirmed) {
        throw new Error("forward_confirm_commit_failed");
      }

      return {
        status: 200,
        body: {
          ok: true,
          confirmed: true,
          intent,
          removed: Boolean(deactivated.deactivated),
          address,
        },
      };
    });
  }

  private async confirmSubscribe(
    tokenHash32: Buffer,
    address: string,
    toEmail: string,
    aliasName: string,
    aliasDomain: string,
    intent: string,
    isAddressIntent: boolean,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    let domainRow: { id: number; name: string; active: number } | null = null;
    if (!isAddressIntent) {
      domainRow = await this.domainRepository.getActiveByName(aliasDomain);
      if (!domainRow) {
        return {
          status: 400,
          body: { ok: false, error: "invalid_domain", domain: aliasDomain },
        };
      }
    }

    const banName = await this.banPolicyService.findActiveNameBan(aliasName);
    if (banName) {
      throw new PublicHttpException(403, { ok: false, error: "banned", ban: banName });
    }

    const banAliasDomain = await this.banPolicyService.findActiveDomainBan(aliasDomain);
    if (banAliasDomain) {
      throw new PublicHttpException(403, { ok: false, error: "banned", ban: banAliasDomain });
    }

    const banDestination = await this.banPolicyService.findActiveEmailOrDomainBan(toEmail);
    if (banDestination) {
      throw new PublicHttpException(403, { ok: false, error: "banned", ban: banDestination });
    }

    const createPayload: {
      address: string;
      goto: string;
      active: number;
      domainId?: number;
    } = {
      address,
      goto: toEmail,
      active: 1,
    };

    if (domainRow) {
      createPayload.domainId = domainRow.id;
    }

    return this.databaseService.withTransaction(async (connection) => {
      const lockedPending = await this.emailConfirmationsRepository.getPendingByTokenHash(
        tokenHash32,
        connection,
        { forUpdate: true },
      );
      if (!lockedPending) {
        return { status: 400, body: { ok: false, error: "invalid_or_expired" } };
      }

      const existing = await this.aliasRepository.getByAddress(address, connection, { forUpdate: true });
      if (existing && existing.id) {
        const currentGoto = String(existing.goto || "").trim().toLowerCase();
        if (currentGoto && currentGoto !== toEmail) {
          return { status: 409, body: { ok: false, error: "alias_owner_changed", address } };
        }

        const confirmed = await this.emailConfirmationsRepository.markConfirmedById(
          lockedPending.id,
          connection,
        );
        if (!confirmed) {
          throw new Error("forward_confirm_commit_failed");
        }

        return {
          status: 200,
          body: {
            ok: true,
            confirmed: true,
            intent,
            created: false,
            reason: "already_exists",
            address,
            goto: toEmail,
          },
        };
      }

      const reservedHandle = await this.aliasRepository.existsReservedHandle(aliasName, connection);
      if (reservedHandle) {
        return { status: 409, body: { ok: false, error: "alias_taken", address } };
      }

      const created = await this.aliasRepository.createIfNotExists(createPayload, connection);
      const confirmed = await this.emailConfirmationsRepository.markConfirmedById(
        lockedPending.id,
        connection,
      );
      if (!confirmed) {
        throw new Error("forward_confirm_commit_failed");
      }

      if (!created.created) {
        return {
          status: 200,
          body: {
            ok: true,
            confirmed: true,
            intent,
            created: false,
            reason: "already_exists",
            address,
            goto: toEmail,
          },
        };
      }

      return {
        status: 200,
        body: {
          ok: true,
          confirmed: true,
          intent,
          created: true,
          address,
          goto: toEmail,
        },
      };
    });
  }

  private async checkBans(aliasName: string, aliasDomain: string, destinationEmail: string): Promise<void> {
    const banName = await this.banPolicyService.findActiveNameBan(aliasName);
    if (banName) {
      throw new PublicHttpException(403, { error: "banned", ban: banName });
    }

    const banAliasDomain = await this.banPolicyService.findActiveDomainBan(aliasDomain);
    if (banAliasDomain) {
      throw new PublicHttpException(403, { error: "banned", ban: banAliasDomain });
    }

    const banDestination = await this.banPolicyService.findActiveEmailOrDomainBan(destinationEmail);
    if (banDestination) {
      throw new PublicHttpException(403, { error: "banned", ban: banDestination });
    }
  }
}
