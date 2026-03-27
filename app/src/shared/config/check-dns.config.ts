import { registerAs } from "@nestjs/config";

import { getInt, getString } from "./env.utils.js";

export const checkDnsConfig = registerAs("checkDns", () => ({
  baseUrl: getString("CHECKDNS_BASE_URL", "").trim().replace(/\/+$/, ""),
  token: getString("CHECKDNS_TOKEN", "").trim(),
  httpTimeoutMs: getInt("CHECKDNS_HTTP_TIMEOUT_MS", 8000),
  maxPayloadBytes: getInt("CHECKDNS_MAX_PAYLOAD_BYTES", 64 * 1024)
}));
