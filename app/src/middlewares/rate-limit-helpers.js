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
};

module.exports = { rateLimitHelpers };
