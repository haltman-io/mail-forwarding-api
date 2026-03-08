"use strict";

/**
 * @fileoverview Stats controller.
 */

const { domainRepository } = require("../repositories/domain-repository");
const { aliasRepository } = require("../repositories/alias-repository");
const { logError } = require("../lib/logger");

let cache = { at: 0, data: null };
const CACHE_TTL_MS = 60_000;

/**
 * GET /stats
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function getStats(req, res) {
  try {
    const now = Date.now();
    if (cache.data && now - cache.at < CACHE_TTL_MS) {
      return res.json(cache.data);
    }

    const [domains, aliases] = await Promise.all([
      domainRepository.countActive(),
      aliasRepository.countActive(),
    ]);

    const data = { domains, aliases };
    cache = { at: now, data };

    res.set("Cache-Control", "public, max-age=60");
    return res.json(data);
  } catch (err) {
    logError("stats.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

module.exports = {
  getStats,
};
