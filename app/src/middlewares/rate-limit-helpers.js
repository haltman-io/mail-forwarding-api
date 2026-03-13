"use strict";

/**
 * @fileoverview Helper functions for rate-limit key generation.
 */

const rateLimitHelpers = {
  /**
   * Normalize string values to lower-case keys.
   * @param {unknown} value
   * @returns {string}
   */
  normalizeString: (value) => {
    if (typeof value !== "string") return "";
    return value.trim().toLowerCase();
  },

  /**
   * Normalize email values (no validation).
   * @param {unknown} value
   * @returns {string}
   */
  normalizeEmail: (value) => {
    return rateLimitHelpers.normalizeString(value);
  },

  /**
   * Normalize POST body email values (default field: "email").
   * @param {import("express").Request} req
   * @param {string} [field]
   * @returns {string}
   */
  normalizeBodyEmail: (req, field = "email") =>
    rateLimitHelpers.normalizeEmail(req.body?.[field] || req.query?.[field] || ""),

  /**
   * @param {import("express").Request} req
   * @returns {string}
   */
  normalizeGetTo: (req) => rateLimitHelpers.normalizeEmail(req.query?.to),

  /**
   * @param {import("express").Request} req
   * @returns {string}
   */
  normalizeGetDomain: (req) => rateLimitHelpers.normalizeString(req.query?.domain || ""),

  /**
   * @param {import("express").Request} req
   * @returns {string}
   */
  normalizeGetName: (req) => rateLimitHelpers.normalizeString(req.query?.name || ""),

  /**
   * Normalize "address" (unsubscribe).
   * @param {import("express").Request} req
   * @returns {string}
   */
  normalizeGetAddress: (req) => rateLimitHelpers.normalizeEmail(req.query?.address),

  /**
   * Normalize token values for stable keys.
   * @param {import("express").Request} req
   * @returns {string}
   */
  normalizeGetToken: (req) =>
    rateLimitHelpers.normalizeString(req.query?.token || req.params?.token || ""),

  /**
   * Normalize token values from body/query/params for stable keys.
   * @param {import("express").Request} req
   * @returns {string}
   */
  normalizeToken: (req) =>
    rateLimitHelpers.normalizeString(req.body?.token || req.query?.token || req.params?.token || ""),

  /**
   * Normalize auth email from request body/query.
   * @param {import("express").Request} req
   * @returns {string}
   */
  normalizeAuthEmail: (req) => rateLimitHelpers.normalizeBodyEmail(req, "email"),

  /**
   * Backward-compatible alias used by older admin login limiters.
   * @param {import("express").Request} req
   * @returns {string}
   */
  normalizeAdminLoginEmail: (req) => rateLimitHelpers.normalizeAuthEmail(req),
};

module.exports = { rateLimitHelpers };
