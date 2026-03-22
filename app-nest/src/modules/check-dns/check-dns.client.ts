import { Inject, Injectable } from "@nestjs/common";
import type { ConfigType } from "@nestjs/config";
import axios, { type AxiosInstance, type AxiosResponse } from "axios";

import { checkDnsConfig } from "../../shared/config/check-dns.config.js";

@Injectable()
export class CheckDnsClient {
  private readonly client: AxiosInstance;

  constructor(
    @Inject(checkDnsConfig.KEY)
    private readonly config: ConfigType<typeof checkDnsConfig>
  ) {
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: config.httpTimeoutMs,
      maxContentLength: config.maxPayloadBytes,
      maxBodyLength: config.maxPayloadBytes,
      maxRedirects: 0,
      validateStatus: () => true,
    });
  }

  requestUi(target: string): Promise<AxiosResponse> {
    return this.client.post(
      "/request/ui",
      { target },
      { headers: { "x-api-key": this.config.token, "content-type": "application/json" } }
    );
  }

  requestEmail(target: string): Promise<AxiosResponse> {
    return this.client.post(
      "/request/email",
      { target },
      { headers: { "x-api-key": this.config.token, "content-type": "application/json" } }
    );
  }

  checkDns(target: string): Promise<AxiosResponse> {
    return this.client.get(`/api/checkdns/${encodeURIComponent(target)}`, {
      headers: { "x-api-key": this.config.token },
    });
  }
}
