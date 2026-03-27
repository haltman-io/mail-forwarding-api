import { registerAs } from "@nestjs/config";

import { normalizeOriginInput, uniqueOrigins } from "../tenancy/origin.utils.js";
import { getBool, getString, getStringList } from "./env.utils.js";

export const corsConfig = registerAs("cors", () => {
  const configuredOrigins = getStringList("CORS_ALLOWED_ORIGINS", [])
    .map((origin) => normalizeOriginInput(origin))
    .filter((origin): origin is string => origin !== null);

  const publicOrigin = normalizeOriginInput(getString("APP_PUBLIC_URL", ""));

  return {
    allowCredentials: getBool("CORS_ALLOW_CREDENTIALS", true),
    allowedOrigins: uniqueOrigins([
      ...configuredOrigins,
      ...(publicOrigin ? [publicOrigin] : [])
    ])
  };
});
