"use strict";

/**
 * @fileoverview Structured logging utilities for the API.
 */

const crypto = require("crypto");
const { config } = require("../config");

const LEVELS = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const DEFAULT_LEVEL = String(config.logLevel || "info").toLowerCase();
const MIN_LEVEL = LEVELS[DEFAULT_LEVEL] ?? LEVELS.info;

const REDACT_KEYS = [
  "password",
  "pass",
  "secret",
  "token",
  "authorization",
  "cookie",
  "set-cookie",
  "api_key",
  "apikey",
  "smtp",
  "mariadb",
];

const MAX_STRING_LENGTH = 2000;
const MAX_DEPTH = 4;
const MAX_KEYS = 80;
const MAX_ARRAY = 80;

function isPlainObject(value) {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function safeObjectTag(value) {
  try {
    return Object.prototype.toString.call(value);
  } catch (_) {
    return "<unstringifiable>";
  }
}

function shouldRedact(key) {
  if (!key) return false;
  const k = String(key).toLowerCase();
  return REDACT_KEYS.some((needle) => k.includes(needle));
}

function truncateString(value) {
  if (typeof value !== "string") return value;
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_LENGTH)}...<truncated>`;
}

function serializeError(err) {
  if (!err) return err;
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      code: err.code,
      errno: err.errno,
      sqlState: err.sqlState,
      sqlMessage: err.sqlMessage,
      cause: err.cause ? serializeError(err.cause) : undefined,
    };
  }

  if (typeof err === "object") {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      code: err.code,
      data: err.data,
    };
  }

  return { message: String(err) };
}

/**
 * Sanitize values for structured logging.
 * @param {unknown} value
 * @param {number} depth
 * @returns {unknown}
 */
function sanitize(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return "<max_depth>";

  if (value instanceof Error) {
    return serializeError(value);
  }

  if (typeof value === "string") return truncateString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return Number(value);

  if (Buffer.isBuffer(value)) {
    return `<buffer:${value.length}>`;
  }

  if (Array.isArray(value)) {
    const out = [];
    const limit = Math.min(value.length, MAX_ARRAY);
    for (let i = 0; i < limit; i++) {
      out.push(sanitize(value[i], depth + 1));
    }
    if (value.length > limit) out.push(`<${value.length - limit} more>`);
    return out;
  }

  if (isPlainObject(value)) {
    const out = {};
    const keys = Object.keys(value);
    const limit = Math.min(keys.length, MAX_KEYS);
    for (let i = 0; i < limit; i++) {
      const key = keys[i];
      if (shouldRedact(key)) {
        out[key] = "[REDACTED]";
      } else {
        out[key] = sanitize(value[key], depth + 1);
      }
    }
    if (keys.length > limit) out._truncated_keys = keys.length - limit;
    return out;
  }

  try {
    return truncateString(String(value));
  } catch (_) {
    return safeObjectTag(value);
  }
}

function safeStringify(payload) {
  const seen = new WeakSet();
  return JSON.stringify(payload, (key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[Circular]";
      seen.add(value);
    }
    return value;
  });
}

function isLevelEnabled(level) {
  const value = LEVELS[level] ?? LEVELS.info;
  return value >= MIN_LEVEL;
}

/**
 * Write a structured log line to stdout.
 * @param {keyof typeof LEVELS} level
 * @param {string} message
 * @param {Record<string, unknown> | null} context
 */
function log(level, message, context = null) {
  if (!isLevelEnabled(level)) return;

  const payload = {
    ts: new Date().toISOString(),
    level,
    msg: message,
  };

  if (context && Object.keys(context).length > 0) {
    payload.ctx = sanitize(context);
  }

  console.log(safeStringify(payload));
}

const logger = {
  trace: (msg, ctx) => log("trace", msg, ctx),
  debug: (msg, ctx) => log("debug", msg, ctx),
  info: (msg, ctx) => log("info", msg, ctx),
  warn: (msg, ctx) => log("warn", msg, ctx),
  error: (msg, ctx) => log("error", msg, ctx),
  fatal: (msg, ctx) => log("fatal", msg, ctx),
};

/**
 * Create a request id suitable for correlation.
 * @returns {string}
 */
function createRequestId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Ensure req.id is populated and echoed back in response headers.
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @returns {string}
 */
function ensureRequestId(req, res) {
  const headerId = req.headers["x-request-id"];
  const reqId = String(headerId || "").trim() || createRequestId();
  req.id = reqId;
  if (res && typeof res.setHeader === "function") {
    res.setHeader("x-request-id", reqId);
  }
  return reqId;
}

/**
 * Build a standard request context for logs.
 * @param {import("express").Request | undefined} req
 * @param {{ includeQuery?: boolean, includeParams?: boolean, includeBody?: boolean }} opts
 * @returns {Record<string, unknown>}
 */
function requestContext(req, opts = {}) {
  if (!req) return {};
  const ctx = {
    req_id: req.id,
    method: req.method,
    path: req.originalUrl || req.url,
    ip: req.ip,
    ua: req.headers?.["user-agent"],
    referer: req.headers?.referer || req.headers?.referrer,
  };

  if (opts.includeQuery) ctx.query = req.query;
  if (opts.includeParams) ctx.params = req.params;
  if (opts.includeBody) ctx.body = req.body;

  return ctx;
}

/**
 * Log errors with request context.
 * @param {string} message
 * @param {unknown} err
 * @param {import("express").Request | undefined} req
 * @param {Record<string, unknown>} extra
 */
function logError(message, err, req, extra = {}) {
  logger.error(message, {
    ...requestContext(req, { includeQuery: true, includeParams: true, includeBody: true }),
    ...extra,
    err,
  });
}

/**
 * Register process-level handlers to log unexpected failures.
 */
function registerProcessHandlers() {
  process.on("unhandledRejection", (reason) => {
    logError("process.unhandledRejection", reason);
  });

  process.on("uncaughtException", (err) => {
    logError("process.uncaughtException", err);
    process.exit(1);
  });
}

module.exports = {
  logger,
  logError,
  ensureRequestId,
  requestContext,
  registerProcessHandlers,
};
