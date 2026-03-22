import { Controller, Get, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";

import { DatabaseService } from "../../shared/database/database.service.js";
import { AppLogger } from "../../shared/logging/app-logger.service.js";
import { sha256Buffer } from "../../shared/utils/crypto.js";
import {
  isConfirmationCodeValid,
  normalizeConfirmationCode,
} from "../../shared/utils/confirmation-code.js";
import {
  normalizeLowerTrim,
  isValidLocalPart,
  isValidDomain,
  parseMailbox,
  MAX_EMAIL_LENGTH,
} from "../../shared/validation/mailbox.js";
import { BanPolicyService } from "../bans/ban-policy.service.js";
import { DomainRepository } from "../domains/domain.repository.js";
import { AliasRepository } from "../api/repositories/alias.repository.js";
import { EmailConfirmationsRepository } from "./repositories/email-confirmations.repository.js";
import { EmailConfirmationService } from "./services/email-confirmation.service.js";
import { ConfigService } from "@nestjs/config";

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

@Controller()
export class ForwardingController {
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

  @Get("forward/subscribe")
  async subscribe(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const query = req.query as Record<string, unknown>;
      const nameRaw = query?.name;
      const domainRaw = query?.domain;
      const addressRaw = query?.address;
      const toRaw = typeof query?.to === "string" ? query.to : "";

      const addressProvided = addressRaw !== undefined;

      if (addressProvided) {
        if (nameRaw !== undefined) {
          res.status(400).json({
            error: "invalid_params",
            field: "name",
            reason: "address_incompatible_with_name",
          });
          return;
        }
        if (domainRaw !== undefined) {
          res.status(400).json({
            error: "invalid_params",
            field: "domain",
            reason: "address_incompatible_with_domain",
          });
          return;
        }
      }

      if (!toRaw) {
        res.status(400).json({ error: "invalid_params", field: "to" });
        return;
      }

      const toParsed = parseMailbox(toRaw);
      if (!toParsed) {
        res.status(400).json({
          error: "invalid_params",
          field: "to",
          hint: "allowed local: RFC 5322 dot-atom; domain: strict DNS (RFC 1035); lowercase",
        });
        return;
      }

      let aliasName = "";
      let aliasDomain = "";
      let aliasAddress = "";
      let domainRow: { id: number; name: string; active: number } | null = null;
      let intent = "subscribe";

      if (addressProvided) {
        const addressParsed = parseMailbox(addressRaw);
        if (!addressParsed) {
          res.status(400).json({
            error: "invalid_params",
            field: "address",
            hint: "expected: valid email address (local: RFC 5322 dot-atom; domain: strict DNS RFC 1035)",
          });
          return;
        }

        aliasName = addressParsed.local;
        aliasDomain = addressParsed.domain;
        aliasAddress = addressParsed.email;
        intent = "subscribe_address";
      } else {
        const name = normalizeLowerTrim(nameRaw);
        const domainInput = normalizeLowerTrim(domainRaw);

        if (!name) {
          res.status(400).json({ error: "invalid_params", field: "name" });
          return;
        }

        if (!isValidLocalPart(name)) {
          res.status(400).json({
            error: "invalid_params",
            field: "name",
            hint: "allowed: RFC 5322 dot-atom local-part; max 64",
          });
          return;
        }

        const apiCredentialsSettings = this.configService.getOrThrow<{ defaultAliasDomain: string }>("apiCredentials");
        const defaultDomain = normalizeLowerTrim(apiCredentialsSettings.defaultAliasDomain);
        const chosenDomain = domainInput || defaultDomain;

        if (!chosenDomain) {
          res.status(500).json({
            error: "server_misconfigured",
            field: "DEFAULT_ALIAS_DOMAIN",
          });
          return;
        }

        if (!isValidDomain(chosenDomain)) {
          const status = domainInput ? 400 : 500;
          res.status(status).json({
            error: domainInput ? "invalid_params" : "server_misconfigured",
            field: "domain",
            hint: "allowed: strict DNS domain (a-z 0-9 hyphen dot), TLD letters >=2",
          });
          return;
        }

        aliasName = name;
        aliasDomain = chosenDomain;
        aliasAddress = `${name}@${chosenDomain}`;
      }

      const banName = await this.banPolicyService.findActiveNameBan(aliasName);
      if (banName) {
        res.status(403).json({ error: "banned", ban: banName });
        return;
      }

      const banAliasDomain = await this.banPolicyService.findActiveDomainBan(aliasDomain);
      if (banAliasDomain) {
        res.status(403).json({ error: "banned", ban: banAliasDomain });
        return;
      }

      const banDestination = await this.banPolicyService.findActiveEmailOrDomainBan(toParsed.email);
      if (banDestination) {
        res.status(403).json({ error: "banned", ban: banDestination });
        return;
      }

      if (!addressProvided) {
        domainRow = await this.domainRepository.getActiveByName(aliasDomain);
        if (!domainRow) {
          res.status(400).json({
            error: "invalid_domain",
            field: "domain",
            hint: "domain must exist in database and be active",
          });
          return;
        }
      }

      const taken = await this.aliasRepository.existsByAddress(aliasAddress);
      if (taken) {
        res.status(409).json({
          ok: false,
          error: "alias_taken",
          address: aliasAddress,
        });
        return;
      }

      const reservedHandle = await this.aliasRepository.existsReservedHandle(aliasName);
      if (reservedHandle) {
        res.status(409).json({
          ok: false,
          error: "alias_taken",
          address: aliasAddress,
        });
        return;
      }

      const toIsAlias = await this.aliasRepository.existsByAddress(toParsed.email);
      if (toIsAlias) {
        res.status(400).json({
          ok: false,
          error: "invalid_params",
          field: "to",
          reason: "destination_cannot_be_an_existing_alias",
          to: toParsed.email,
        });
        return;
      }

      for (const suffix of domainSuffixes(toParsed.domain)) {
        const isManaged = await this.domainRepository.getActiveByName(suffix);
        if (isManaged) {
          res.status(400).json({
            ok: false,
            error: "invalid_params",
            field: "to",
            reason: "destination_cannot_use_managed_domain",
            to: toParsed.email,
            managed_domain_match: suffix,
          });
          return;
        }
      }

      if (toParsed.email === aliasAddress) {
        res.status(400).json({
          ok: false,
          error: "invalid_params",
          field: "to",
          reason: "destination_cannot_be_the_same_as_alias",
          to: toParsed.email,
          alias: aliasAddress,
        });
        return;
      }

      const result = await this.emailConfirmationService.sendEmailConfirmation({
        email: toParsed.email,
        requestIpText: req.ip,
        userAgent: String(req.headers["user-agent"] || ""),
        requestOrigin: req.get("origin") || "",
        requestReferer: req.get("referer") || req.get("referrer") || "",
        aliasName,
        aliasDomain,
        intent,
      });

      const forwardingSettings = this.configService.getOrThrow<{ emailConfirmationTtlMinutes: number }>("forwarding");
      const ttlMinutes = Number(forwardingSettings.emailConfirmationTtlMinutes ?? 10);
      const ttl = Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes : 10;

      res.status(200).json({
        ok: true,
        action: "subscribe",
        alias_candidate: addressProvided ? aliasAddress : `${aliasName}@${domainRow!.name}`,
        to: toParsed.email,
        confirmation: {
          sent: Boolean(result.sent),
          ttl_minutes: ttl,
        },
      });
    } catch (err) {
      this.logger.logError("subscribe.error", err, req);
      res.status(500).json({ error: "internal_error" });
    }
  }

  @Get("forward/unsubscribe")
  async unsubscribe(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const query = req.query as Record<string, unknown>;
      const aliasRaw = typeof query?.alias === "string" ? query.alias : "";
      const aliasParsed = parseEmailLoose(aliasRaw);
      const clientIp = req.ip || "";

      if (!aliasParsed) {
        res.status(400).json({ error: "invalid_params", field: "alias" });
        return;
      }

      const aliasName = aliasParsed.local;
      const aliasDomain = aliasParsed.domain;

      if (!isValidLocalPart(aliasName)) {
        res.status(400).json({ error: "invalid_params", field: "alias_name" });
        return;
      }
      if (!isValidDomain(aliasDomain)) {
        res.status(400).json({ error: "invalid_params", field: "alias_domain" });
        return;
      }

      if (clientIp) {
        const ipBan = await this.banPolicyService.findActiveIpBan(clientIp);
        if (ipBan) {
          res.status(403).json({ error: "banned", type: "ip" });
          return;
        }
      }

      const address = `${aliasName}@${aliasDomain}`;
      const aliasRow = await this.aliasRepository.getByAddress(address);

      if (!aliasRow || !aliasRow.id) {
        res.status(404).json({ error: "alias_not_found", alias: address });
        return;
      }

      if (aliasRow.active === 0) {
        res.status(400).json({ error: "alias_inactive", alias: address });
        return;
      }

      const gotoEmail = String(aliasRow.goto || "").trim().toLowerCase();
      const gotoParsed = parseMailbox(gotoEmail);

      if (!gotoParsed) {
        res.status(500).json({ error: "invalid_goto_on_alias", alias: address });
        return;
      }

      const gotoBan = await this.banPolicyService.findActiveEmailOrDomainBan(gotoParsed.email);
      if (gotoBan) {
        if (gotoBan.ban_type === "email") {
          res.status(403).json({ error: "banned", type: "email" });
        } else {
          res.status(403).json({ error: "banned", type: "domain", value: gotoBan.ban_value });
        }
        return;
      }

      const result = await this.emailConfirmationService.sendEmailConfirmation({
        email: gotoParsed.email,
        requestIpText: req.ip,
        userAgent: String(req.headers["user-agent"] || ""),
        requestOrigin: req.get("origin") || "",
        requestReferer: req.get("referer") || req.get("referrer") || "",
        aliasName,
        aliasDomain,
        intent: "unsubscribe",
      });

      res.status(200).json({
        ok: true,
        action: "unsubscribe",
        alias: address,
        sent: Boolean(result.sent),
        reason: result.reason || undefined,
        ttl_minutes: result.ttl_minutes,
      });
    } catch (err) {
      this.logger.logError("unsubscribe.error", err, req);
      res.status(500).json({ error: "internal_error" });
    }
  }

  @Get("forward/confirm")
  async confirm(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const query = req.query as Record<string, unknown>;
      const rawToken = typeof query?.token === "string" ? query.token : "";
      const token = normalizeConfirmationCode(rawToken);

      if (!isConfirmationCodeValid(token)) {
        res.status(400).json({ ok: false, error: "invalid_token" });
        return;
      }

      const tokenHash32 = sha256Buffer(token);
      const pending = await this.emailConfirmationsRepository.getPendingByTokenHash(tokenHash32);

      if (!pending) {
        res.status(400).json({ ok: false, error: "invalid_or_expired" });
        return;
      }

      const toEmail = String(pending.email || "").trim().toLowerCase();
      const intent = String(pending.intent || "subscribe").trim().toLowerCase();
      const aliasName = String(pending.alias_name || "").trim().toLowerCase();
      const aliasDomain = String(pending.alias_domain || "").trim().toLowerCase();

      if (!toEmail || !aliasName || !aliasDomain) {
        res.status(500).json({
          ok: false,
          error: "confirmation_payload_missing",
        });
        return;
      }

      const address = `${aliasName}@${aliasDomain}`;

      if (intent === "unsubscribe") {
        const result = await this.databaseService.withTransaction(async (connection) => {
          const lockedPending = await this.emailConfirmationsRepository.getPendingByTokenHash(
            tokenHash32,
            connection,
            { forUpdate: true },
          );
          if (!lockedPending) {
            return {
              status: 400,
              body: { ok: false, error: "invalid_or_expired" },
            } as const;
          }

          const row = await this.aliasRepository.getByAddress(
            address,
            connection,
            { forUpdate: true },
          );
          if (!row || !row.id) {
            return {
              status: 404,
              body: { ok: false, error: "alias_not_found", address },
            } as const;
          }

          const currentGoto = String(row.goto || "").trim().toLowerCase();
          if (currentGoto && currentGoto !== toEmail) {
            return {
              status: 409,
              body: {
                ok: false,
                error: "alias_owner_changed",
                address,
              },
            } as const;
          }

          const del = await this.aliasRepository.deleteByAddress(address, connection);
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
              removed: Boolean(del.deleted),
              address,
            },
          } as const;
        });

        res.status(result.status).json(result.body);
        return;
      }

      const isAddressIntent = intent === "subscribe_address";
      if (intent !== "subscribe" && !isAddressIntent) {
        res.status(400).json({ ok: false, error: "unsupported_intent", intent });
        return;
      }

      let domainRow: { id: number; name: string; active: number } | null = null;
      if (!isAddressIntent) {
        domainRow = await this.domainRepository.getActiveByName(aliasDomain);
        if (!domainRow) {
          res.status(400).json({
            ok: false,
            error: "invalid_domain",
            domain: aliasDomain,
          });
          return;
        }
      }

      const banName = await this.banPolicyService.findActiveNameBan(aliasName);
      if (banName) {
        res.status(403).json({ ok: false, error: "banned", ban: banName });
        return;
      }

      const banAliasDomain = await this.banPolicyService.findActiveDomainBan(aliasDomain);
      if (banAliasDomain) {
        res.status(403).json({ ok: false, error: "banned", ban: banAliasDomain });
        return;
      }

      const banDestination = await this.banPolicyService.findActiveEmailOrDomainBan(toEmail);
      if (banDestination) {
        res.status(403).json({ ok: false, error: "banned", ban: banDestination });
        return;
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

      const result = await this.databaseService.withTransaction(async (connection) => {
        const lockedPending = await this.emailConfirmationsRepository.getPendingByTokenHash(
          tokenHash32,
          connection,
          { forUpdate: true },
        );
        if (!lockedPending) {
          return {
            status: 400,
            body: { ok: false, error: "invalid_or_expired" },
          } as const;
        }

        const existing = await this.aliasRepository.getByAddress(
          address,
          connection,
          { forUpdate: true },
        );
        if (existing && existing.id) {
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
          } as const;
        }

        const reservedHandle = await this.aliasRepository.existsReservedHandle(
          aliasName,
          connection,
        );
        if (reservedHandle) {
          return {
            status: 409,
            body: {
              ok: false,
              error: "alias_taken",
              address,
            },
          } as const;
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
          } as const;
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
        } as const;
      });

      res.status(result.status).json(result.body);
    } catch (err) {
      this.logger.logError("confirm.error", err, req);
      res.status(500).json({ ok: false, error: "internal_error" });
    }
  }
}
