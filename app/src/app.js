"use strict";

/**
 * @fileoverview Express application setup.
 */

const express = require("express");
const cors = require("cors");

const { config } = require("./config");
const { router } = require("./routes");
const { requestLogger } = require("./middlewares/request-logger");
const { denyBannedIp } = require("./middlewares/ip-ban");
const { errorHandler } = require("./middlewares/error-handler");
const { isOriginAllowed } = require("./lib/cors-origin-policy");

function buildCorsOptions() {
  return {
    credentials: Boolean(config.corsAllowCredentials),
    async origin(origin, callback) {
      if (!origin) return callback(null, true);

      try {
        return callback(null, await isOriginAllowed(origin));
      } catch (_) {
        return callback(null, false);
      }
    },
  };
}

const app = express();

// Trust proxy so req.ip is correct behind a reverse proxy.
app.set("trust proxy", config.trustProxy);
// MariaDB BIGINT may come as JS BigInt; convert to string in JSON responses.
app.set("json replacer", (key, value) => {
  if (typeof value === "bigint") return value.toString();
  return value;
});

app.use(requestLogger);
app.use(denyBannedIp);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cors(buildCorsOptions()));
app.disable("x-powered-by");

app.use("/", router);

app.use((req, res) => {
  res.status(404).json({ error: "not_found" });
});

app.use(errorHandler);

module.exports = { app };
