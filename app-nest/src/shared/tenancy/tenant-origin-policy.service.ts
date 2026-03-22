import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { normalizeOriginInput } from "./origin.utils.js";

@Injectable()
export class TenantOriginPolicyService {
  private readonly allowedOrigins: Set<string>;
  private readonly allowCredentials: boolean;

  constructor(private readonly configService: ConfigService) {
    const corsSettings = this.configService.getOrThrow<{
      allowedOrigins: string[];
      allowCredentials: boolean;
    }>("cors");

    this.allowedOrigins = new Set(corsSettings.allowedOrigins);
    this.allowCredentials = corsSettings.allowCredentials;
  }

  resolveAllowedOrigin(originHeader: string | undefined): string | null {
    const normalized = normalizeOriginInput(originHeader ?? "");
    if (!normalized) return null;
    return this.allowedOrigins.has(normalized) ? normalized : null;
  }

  shouldAllowCredentials(originHeader: string | undefined): boolean {
    return this.allowCredentials && this.resolveAllowedOrigin(originHeader) !== null;
  }
}
