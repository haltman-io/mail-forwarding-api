"use strict";

/**
 * @fileoverview Express application setup.
 */

const express = require("express");
const cors = require("cors");

const { config } = require("./config");
const { router } = require("./routes");
const { requestLogger } = require("./middlewares/request-logger");
const { errorHandler } = require("./middlewares/error-handler");

const app = express();

// Trust proxy so req.ip is correct behind a reverse proxy.
app.set("trust proxy", config.trustProxy);

app.use(requestLogger);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cors());
app.disable("x-powered-by");

app.use("/", router);

app.use((req, res) => {
  res.redirect("https://github.com/haltman-io");
});

app.use(errorHandler);

module.exports = { app };
