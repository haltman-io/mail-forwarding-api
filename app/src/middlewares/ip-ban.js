"use strict";

/**
 * @fileoverview Global middleware to deny requests from banned IPs.
 */

const { findActiveIpBan } = require("../lib/ban-policy");
const { logError } = require("../lib/logger");

/**
 * Block any request from an actively banned IP.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
async function denyBannedIp(req, res, next) {
  try {
    const ban = await findActiveIpBan(req.ip);
    if (ban) return res.status(403).json({ error: "banned", ban });
    return next();
  } catch (err) {
    logError("ip_ban.check.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

module.exports = { denyBannedIp };

