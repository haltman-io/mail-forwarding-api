"use strict";

/**
 * @fileoverview Express error handler that logs and returns safe responses.
 */

const { logError } = require("../lib/logger");
const { AppError } = require("../lib/errors");

/**
 * Express error middleware.
 * @param {Error} err
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
function errorHandler(err, req, res, next) {
  logError("request.error", err, req);

  if (res.headersSent) return next(err);

  if (err instanceof AppError && err.expose) {
    return res.status(err.statusCode).json({ error: err.code });
  }

  return res.status(500).json({ error: "internal_error" });
}

module.exports = { errorHandler };
