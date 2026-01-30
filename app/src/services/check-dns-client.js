"use strict";

/**
 * @fileoverview Axios client for the check-dns relay integration.
 */

const axios = require("axios");
const { config } = require("../config");

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_PAYLOAD_BYTES = 64 * 1024;

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function assertRequiredConfig() {
  const baseUrl = normalizeBaseUrl(config.checkDnsBaseUrl);
  const token = String(config.checkDnsToken || "").trim();

  if (!baseUrl) throw new Error("missing_CHECKDNS_BASE_URL");
  if (!token) throw new Error("missing_CHECKDNS_TOKEN");

  return { baseUrl, token };
}

const requiredConfig = assertRequiredConfig();

const timeoutRaw = Number(config.checkDnsHttpTimeoutMs ?? DEFAULT_TIMEOUT_MS);
const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DEFAULT_TIMEOUT_MS;

const client = axios.create({
  baseURL: requiredConfig.baseUrl,
  timeout: timeoutMs,
  maxContentLength: MAX_PAYLOAD_BYTES,
  maxBodyLength: MAX_PAYLOAD_BYTES,
  validateStatus: () => true,
});

function buildHeaders(isJson) {
  if (isJson) {
    return { "x-api-key": requiredConfig.token, "content-type": "application/json" };
  }
  return { "x-api-key": requiredConfig.token };
}

/**
 * POST /request/ui
 * @param {string} target
 * @returns {Promise<import("axios").AxiosResponse>}
 */
function requestUi(target) {
  return client.post("/request/ui", { target }, { headers: buildHeaders(true) });
}

/**
 * POST /request/email
 * @param {string} target
 * @returns {Promise<import("axios").AxiosResponse>}
 */
function requestEmail(target) {
  return client.post("/request/email", { target }, { headers: buildHeaders(true) });
}

/**
 * GET /api/checkdns/:target
 * @param {string} target
 * @returns {Promise<import("axios").AxiosResponse>}
 */
function checkDns(target) {
  const encoded = encodeURIComponent(target);
  return client.get(`/api/checkdns/${encoded}`, { headers: buildHeaders(false) });
}

module.exports = { requestUi, requestEmail, checkDns };
