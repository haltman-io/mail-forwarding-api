"use strict";

/**
 * @fileoverview Application entrypoint.
 */

const { app } = require("./app");
const { config } = require("./config");
const { logger, registerProcessHandlers } = require("./lib/logger");

const listenHost = config.appHost;
const listenPort = Number(config.appPort);

registerProcessHandlers();

app.listen(listenPort, listenHost, () => {
  logger.info("server.listening", {
    host: listenHost,
    port: listenPort,
    env: config.envName,
  });
});
