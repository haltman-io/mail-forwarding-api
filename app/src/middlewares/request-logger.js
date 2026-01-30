"use strict";

/**
 * @fileoverview Express middleware for request logging with timing.
 */

const { ensureRequestId, requestContext, logger } = require("../lib/logger");

/**
 * Log request start/end with duration and status.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
function requestLogger(req, res, next) {
  ensureRequestId(req, res);
  const startedAt = process.hrtime.bigint();
  req._startedAt = startedAt;

  logger.info("request.start", requestContext(req, { includeQuery: true }));

  res.on("finish", () => {
    const end = process.hrtime.bigint();
    const durationMs = Number(end - startedAt) / 1e6;
    logger.info("request.end", {
      ...requestContext(req),
      status: res.statusCode,
      duration_ms: Math.round(durationMs),
    });
  });

  next();
}

module.exports = { requestLogger };
