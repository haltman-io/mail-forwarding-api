import { Injectable } from "@nestjs/common";
import axios from "axios";
import type { Request } from "express";

import { AppLoggerService } from "../../shared/logging/app-logger.service.js";
import { BanPolicyService } from "../bans/ban-policy.service.js";
import { CheckDnsClient } from "./check-dns.client.js";

export interface RelayResult {
  status: number;
  payload: unknown;
}

@Injectable()
export class CheckDnsService {
  constructor(
    private readonly banPolicy: BanPolicyService,
    private readonly client: CheckDnsClient,
    private readonly logger: AppLoggerService
  ) {}

  requestUi(req: Request, target: string): Promise<RelayResult> {
    return this.relay(req, "POST /request/ui", target, () => this.client.requestUi(target));
  }

  requestEmail(req: Request, target: string): Promise<RelayResult> {
    return this.relay(req, "POST /request/email", target, () => this.client.requestEmail(target));
  }

  checkDns(req: Request, target: string): Promise<RelayResult> {
    return this.relay(req, "GET /api/checkdns/:target", target, () => this.client.checkDns(target));
  }

  private async relay(
    req: Request,
    routeName: string,
    target: string,
    action: () => Promise<{ status: number; data: unknown }>
  ): Promise<RelayResult> {
    const startedAt = process.hrtime.bigint();

    try {
      const ban = await this.banPolicy.findActiveDomainBan(target);
      if (ban) {
        return { status: 403, payload: { error: "banned", ban } };
      }

      const response = await action();
      this.logRelay(routeName, target, startedAt, response.status);
      return {
        status: response.status || 502,
        payload: response.data,
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response && typeof error.response.status === "number") {
        this.logRelay(routeName, target, startedAt, error.response.status);
        return {
          status: error.response.status,
          payload: error.response.data,
        };
      }

      const status = axios.isAxiosError(error) && error.code === "ECONNABORTED" ? 503 : 502;
      this.logger.error("checkdns.relay.error", {
        ...this.logger.requestContext(req, {
          includeBody: true,
          includeParams: true,
          includeQuery: true,
        }),
        route: routeName,
        target,
        duration_ms: this.durationMs(startedAt),
        err: error,
      });

      return {
        status,
        payload: { error: "internal_error" },
      };
    }
  }

  private logRelay(
    routeName: string,
    target: string,
    startedAt: bigint,
    upstreamStatus: number
  ): void {
    this.logger.info("checkdns.relay", {
      route: routeName,
      target,
      upstream_status: upstreamStatus,
      duration_ms: this.durationMs(startedAt),
    });
  }

  private durationMs(startedAt: bigint): number {
    return Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
  }
}
