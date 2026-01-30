"use strict";

/**
 * @fileoverview Relay endpoints for the check-dns service.
 */

const { logger, logError } = require("../lib/logger");
const { normalizeDomainTarget, INVALID_TARGET_ERROR } = require("../lib/domain-validation");
const checkDnsClient = require("../services/check-dns-client");

const UNSUPPORTED_MEDIA_TYPE = { error: "unsupported_media_type" };
const INTERNAL_ERROR = { error: "internal_error" };

function requireJsonBody(req, res) {
  if (!req.is("application/json")) {
    res.status(415).json(UNSUPPORTED_MEDIA_TYPE);
    return false;
  }
  return true;
}

function normalizeTargetOrRespond(res, raw) {
  const normalized = normalizeDomainTarget(raw);
  if (!normalized.ok) {
    res.status(400).json({ error: normalized.error || INVALID_TARGET_ERROR });
    return null;
  }
  return normalized.value;
}

function sendUpstreamResponse(res, response) {
  const payload = response?.data;
  const status = response?.status || 502;

  if (payload === undefined) return res.status(status).end();
  if (Buffer.isBuffer(payload)) return res.status(status).send(payload);
  if (typeof payload === "string") return res.status(status).send(payload);
  return res.status(status).json(payload);
}

async function relayRequest(req, res, routeName, target, action) {
  const startedAt = process.hrtime.bigint();

  try {
    const response = await action();
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

    logger.info("checkdns.relay", {
      route: routeName,
      target,
      upstream_status: response.status,
      duration_ms: Math.round(durationMs),
    });

    return sendUpstreamResponse(res, response);
  } catch (err) {
    if (err && err.response && typeof err.response.status === "number") {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      logger.info("checkdns.relay", {
        route: routeName,
        target,
        upstream_status: err.response.status,
        duration_ms: Math.round(durationMs),
      });
      return sendUpstreamResponse(res, err.response);
    }

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const status = err && err.code === "ECONNABORTED" ? 503 : 502;

    logError("checkdns.relay.error", err, req, {
      route: routeName,
      target,
      upstream_status: null,
      duration_ms: Math.round(durationMs),
    });

    return res.status(status).json(INTERNAL_ERROR);
  }
}

/**
 * POST /request/ui
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function requestUi(req, res) {
  if (!requireJsonBody(req, res)) return;

  const target = normalizeTargetOrRespond(res, req.body?.target);
  if (!target) return;

  return relayRequest(req, res, "POST /request/ui", target, () =>
    checkDnsClient.requestUi(target)
  );
}

/**
 * POST /request/email
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function requestEmail(req, res) {
  if (!requireJsonBody(req, res)) return;

  const target = normalizeTargetOrRespond(res, req.body?.target);
  if (!target) return;

  return relayRequest(req, res, "POST /request/email", target, () =>
    checkDnsClient.requestEmail(target)
  );
}

/**
 * GET /api/checkdns/:target
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 */
async function checkDnsStatus(req, res) {
  const target = normalizeTargetOrRespond(res, req.params?.target);
  if (!target) return;

  return relayRequest(req, res, "GET /api/checkdns/:target", target, () =>
    checkDnsClient.checkDns(target)
  );
}

module.exports = { requestUi, requestEmail, checkDnsStatus };
