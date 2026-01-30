"use strict";

/**
 * @fileoverview Application entrypoint.
 */

const { app } = require("./app");
const { config } = require("./config");
const { logger, registerProcessHandlers } = require("./lib/logger");
const { rateLimit } = require("./middlewares/rate-limit");

const listenHost = config.appHost;
const listenPort = Number(config.appPort);

registerProcessHandlers();

// Initialize Redis store for rate limiting, then start server
(async () => {
  try {
    // Initialize Redis store (falls back to memory if unavailable)
    await rateLimit.initialize();

    app.listen(listenPort, listenHost, () => {
      logger.info("server.listening", {
        host: listenHost,
        port: listenPort,
        env: config.envName,
      });
    });
  } catch (err) {
    logger.error("server.startup.failed", { err: err?.message || String(err) });
    process.exit(1);
  }
})();

