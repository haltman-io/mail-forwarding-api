"use strict";

/**
 * @fileoverview API logging middleware.
 */

const { apiLogsRepository } = require("../repositories/api-logs-repository");
const { packIp16 } = require("../lib/ip-pack");

function safeJsonStringify(obj) {
  try {
    return JSON.stringify(obj ?? null);
  } catch {
    return null;
  }
}

/**
 * Log authenticated API calls (requires req.api_token).
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function apiLogAuthenticated(req, res, next) {
  try {
    const token = req.api_token || null;

    apiLogsRepository
      .insert({
        apiTokenId: token?.id ?? null,
        ownerEmail: token?.owner_email ?? null,
        route: String(req.originalUrl || req.path || "").slice(0, 128),
        body: safeJsonStringify(req.body),
        requestIpPacked: packIp16(req.ip),
        userAgent: String(req.headers["user-agent"] || "").slice(0, 255),
      })
      .catch(() => {});

    return next();
  } catch {
    return next();
  }
}

module.exports = { apiLogAuthenticated };
