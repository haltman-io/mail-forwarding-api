"use strict";

/**
 * @fileoverview Domain controller.
 */

const { domainRepository } = require("../repositories/domain-repository");
const { logError } = require("../lib/logger");

let cache = { at: 0, data: null };
const CACHE_TTL_MS = 10_000;

/**
 * GET /domains
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function getDomains(req, res) {
  try {
    const now = Date.now();
    if (cache.data && now - cache.at < CACHE_TTL_MS) {
      return res.json(cache.data);
    }

    const names = await domainRepository.listActiveNames();
    cache = { at: now, data: names };

    res.set("Cache-Control", "public, max-age=10");
    return res.json(names);
  } catch (err) {
    logError("domains.list.error", err, req);
    return res.status(500).json({ error: "internal_error" });
  }
}

module.exports = {
  getDomains,
};
