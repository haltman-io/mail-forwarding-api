import { registerAs } from "@nestjs/config";

import { getString } from "./env.utils.js";

export const counterConfig = registerAs("counter", () => ({
  secretKey: getString("COUNTER_SECRET_KEY", ""),
}));
