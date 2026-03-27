import { registerAs } from "@nestjs/config";

import { getInt, getString } from "./env.utils.js";

export const databaseConfig = registerAs("database", () => ({
  host: getString("MARIADB_HOST", "127.0.0.1"),
  port: getInt("MARIADB_PORT", 3306),
  user: getString("MARIADB_USER", ""),
  password: getString("MARIADB_PASSWORD", ""),
  database: getString("MARIADB_DATABASE", ""),
  connectionLimit: getInt("MARIADB_CONNECTION_LIMIT", 10),
  acquireTimeout: getInt("MARIADB_ACQUIRE_TIMEOUT_MS", 10000),
  idleTimeout: getInt("MARIADB_IDLE_TIMEOUT_MS", 60000),
  minimumIdle: getInt("MARIADB_MINIMUM_IDLE", 2)
}));
