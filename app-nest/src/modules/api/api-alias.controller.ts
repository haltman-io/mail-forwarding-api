import { Controller, Get, Post, Req, Res, UseGuards, UseInterceptors } from "@nestjs/common";
import type { Request, Response } from "express";

import { AppLogger } from "../../shared/logging/app-logger.service.js";
import {
  normalizeLowerTrim,
  isValidLocalPart,
  isValidDomain,
  parseMailbox,
} from "../../shared/validation/mailbox.js";
import { BanPolicyService } from "../bans/ban-policy.service.js";
import { DomainRepository } from "../domains/domain.repository.js";
import { ApiKeyGuard } from "./guards/api-key.guard.js";
import { ApiLogInterceptor } from "./interceptors/api-log.interceptor.js";
import { AliasRepository } from "./repositories/alias.repository.js";
import { ActivityRepository } from "./repositories/activity.repository.js";

function parsePagination(
  query: Record<string, unknown>,
  options: { defaultLimit?: number; maxLimit?: number } = {},
): { ok: true; limit: number; offset: number } | { ok: false; error: Record<string, unknown> } {
  const defaultLimit = options.defaultLimit ?? 50;
  const maxLimit = options.maxLimit ?? 200;

  const limitRaw = query?.limit;
  const offsetRaw = query?.offset;

  const limitNum = limitRaw === undefined ? defaultLimit : Number(limitRaw);
  const offsetNum = offsetRaw === undefined ? 0 : Number(offsetRaw);

  if (!Number.isInteger(limitNum) || limitNum <= 0) {
    return { ok: false, error: { error: "invalid_params", field: "limit" } };
  }
  if (!Number.isInteger(offsetNum) || offsetNum < 0) {
    return { ok: false, error: { error: "invalid_params", field: "offset" } };
  }

  return {
    ok: true,
    limit: Math.min(limitNum, maxLimit),
    offset: offsetNum,
  };
}

@Controller()
@UseGuards(ApiKeyGuard)
@UseInterceptors(ApiLogInterceptor)
export class ApiAliasController {
  constructor(
    private readonly aliasRepository: AliasRepository,
    private readonly activityRepository: ActivityRepository,
    private readonly domainRepository: DomainRepository,
    private readonly banPolicyService: BanPolicyService,
    private readonly logger: AppLogger,
  ) {}

  @Get("api/alias/list")
  async listAliases(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const owner = req.api_token?.owner_email;
      if (!owner) {
        res.status(401).json({ error: "missing_api_key" });
        return;
      }

      const paging = parsePagination(req.query as Record<string, unknown>);
      if (!paging.ok) {
        res.status(400).json(paging.error);
        return;
      }

      const [items, total] = await Promise.all([
        this.aliasRepository.listByGoto(owner, { limit: paging.limit, offset: paging.offset }),
        this.aliasRepository.countByGoto(owner),
      ]);

      res.status(200).json({
        items,
        pagination: {
          total,
          limit: paging.limit,
          offset: paging.offset,
        },
      });
    } catch (err) {
      this.logger.logError("api.listAliases.error", err, req);
      res.status(500).json({ error: "internal_error" });
    }
  }

  @Get("api/alias/stats")
  async aliasStats(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const owner = req.api_token?.owner_email;
      if (!owner) {
        res.status(401).json({ error: "missing_api_key" });
        return;
      }

      const stats = await this.aliasRepository.getStatsByGoto(owner);
      res.status(200).json(stats);
    } catch (err) {
      this.logger.logError("api.aliasStats.error", err, req);
      res.status(500).json({ error: "internal_error" });
    }
  }

  @Get("api/activity")
  async getActivity(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const owner = req.api_token?.owner_email;
      if (!owner) {
        res.status(401).json({ error: "missing_api_key" });
        return;
      }

      const paging = parsePagination(req.query as Record<string, unknown>, {
        defaultLimit: 50,
        maxLimit: 200,
      });
      if (!paging.ok) {
        res.status(400).json(paging.error);
        return;
      }

      const items = await this.activityRepository.listByOwner(owner, {
        limit: paging.limit,
        offset: paging.offset,
      });

      res.status(200).json({
        items,
        pagination: {
          limit: paging.limit,
          offset: paging.offset,
        },
      });
    } catch (err) {
      this.logger.logError("api.getActivity.error", err, req);
      res.status(500).json({ error: "internal_error" });
    }
  }

  @Post("api/alias/create")
  async createAlias(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const owner = req.api_token?.owner_email;
      if (!owner) {
        res.status(401).json({ error: "missing_api_key" });
        return;
      }

      const body = req.body as Record<string, unknown> | undefined;
      const query = req.query as Record<string, unknown>;

      const handleRaw = body?.alias_handle ?? query?.alias_handle;
      const domainRaw = body?.alias_domain ?? query?.alias_domain;

      const aliasHandle = normalizeLowerTrim(handleRaw);
      const aliasDomain = normalizeLowerTrim(domainRaw);

      if (!aliasHandle) {
        res.status(400).json({ error: "invalid_params", field: "alias_handle" });
        return;
      }
      if (!aliasDomain) {
        res.status(400).json({ error: "invalid_params", field: "alias_domain" });
        return;
      }

      if (!isValidLocalPart(aliasHandle)) {
        res.status(400).json({ error: "invalid_params", field: "alias_handle" });
        return;
      }
      if (!isValidDomain(aliasDomain)) {
        res.status(400).json({ error: "invalid_params", field: "alias_domain" });
        return;
      }

      const banName = await this.banPolicyService.findActiveNameBan(aliasHandle);
      if (banName) {
        res.status(403).json({ error: "banned", ban: banName });
        return;
      }

      const banAliasDomain = await this.banPolicyService.findActiveDomainBan(aliasDomain);
      if (banAliasDomain) {
        res.status(403).json({ error: "banned", ban: banAliasDomain });
        return;
      }

      const banOwner = await this.banPolicyService.findActiveEmailOrDomainBan(owner);
      if (banOwner) {
        res.status(403).json({ error: "banned", ban: banOwner });
        return;
      }

      const domainRow = await this.domainRepository.getActiveByName(aliasDomain);
      if (!domainRow) {
        res.status(400).json({ error: "invalid_domain", field: "alias_domain" });
        return;
      }

      const address = `${aliasHandle}@${aliasDomain}`;

      const reservedHandle = await this.aliasRepository.existsReservedHandle(aliasHandle);
      if (reservedHandle) {
        res.status(409).json({ ok: false, error: "alias_taken", address });
        return;
      }

      const created = await this.aliasRepository.createIfNotExists({
        address,
        goto: owner,
        domainId: domainRow.id,
        active: 1,
      });

      if (created.alreadyExists) {
        res.status(409).json({ ok: false, error: "alias_taken", address });
        return;
      }

      res.status(200).json({ ok: true, created: true, address, goto: owner });
    } catch (err) {
      this.logger.logError("api.createAlias.error", err, req);
      res.status(500).json({ error: "internal_error" });
    }
  }

  @Post("api/alias/delete")
  async deleteAlias(@Req() req: Request, @Res() res: Response): Promise<void> {
    try {
      const owner = req.api_token?.owner_email;
      if (!owner) {
        res.status(401).json({ error: "missing_api_key" });
        return;
      }

      const body = req.body as Record<string, unknown> | undefined;
      const query = req.query as Record<string, unknown>;

      const aliasRaw = body?.alias ?? query?.alias;
      const parsed = parseMailbox(aliasRaw);
      if (!parsed) {
        res.status(400).json({ error: "invalid_params", field: "alias" });
        return;
      }

      const row = await this.aliasRepository.getByAddress(parsed.email);
      if (!row) {
        res.status(404).json({ error: "alias_not_found", alias: parsed.email });
        return;
      }

      const goto = String(row.goto || "").trim().toLowerCase();
      if (goto !== owner) {
        res.status(403).json({ error: "forbidden" });
        return;
      }

      const result = await this.aliasRepository.deleteByAddress(parsed.email);
      if (!result.deleted) {
        res.status(404).json({ error: "alias_not_found", alias: parsed.email });
        return;
      }

      res.status(200).json({ ok: true, deleted: true, alias: parsed.email });
    } catch (err) {
      this.logger.logError("api.deleteAlias.error", err, req);
      res.status(500).json({ error: "internal_error" });
    }
  }
}
