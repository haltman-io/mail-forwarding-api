import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import crypto from "node:crypto";

type RequestWithContext = Request & {
  requestId?: string;
  startedAtHrTime?: bigint;
};

const LEVELS = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
} as const;

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

type LogLevel = keyof typeof LEVELS;

type RequestContextOptions = {
  includeQuery?: boolean;
  includeParams?: boolean;
  includeBody?: boolean;
};

@Injectable()
export class AppLogger {
  private static processHandlersRegistered = false;
  private readonly minLevel: number;

  constructor(configService: ConfigService) {
    const appSettings = configService.getOrThrow<{ logLevel: string }>("app");
    const level = String(appSettings.logLevel ?? "info").toLowerCase() as LogLevel;
    this.minLevel = LEVELS[level] ?? LEVELS.info;
  }

  trace(message: string, context?: Record<string, unknown>): void {
    this.log("trace", message, context);
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log("debug", message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log("info", message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log("warn", message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log("error", message, context);
  }

  fatal(message: string, context?: Record<string, unknown>): void {
    this.log("fatal", message, context);
  }

  ensureRequestId(request: Request, response?: Response): string {
    const requestWithContext = request as RequestWithContext;
    const headerId = request.header("x-request-id");
    const requestId = String(headerId || "").trim() || this.createRequestId();
    requestWithContext.requestId = requestId;

    if (response) {
      response.setHeader("x-request-id", requestId);
    }

    return requestId;
  }

  private createRequestId(): string {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }

    return crypto.randomBytes(16).toString("hex");
  }

  requestContext(
    req: Request | undefined,
    opts: RequestContextOptions = {}
  ): Record<string, unknown> {
    if (!req) return {};
    const requestWithContext = req as RequestWithContext;

    const context: Record<string, unknown> = {
      req_id: requestWithContext.requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      ip: req.ip,
      ua: req.header("user-agent"),
      referer: req.header("referer") || req.header("referrer"),
    };

    if (opts.includeQuery) context.query = req.query;
    if (opts.includeParams) context.params = req.params;
    if (opts.includeBody) context.body = req.body;

    return context;
  }

  logError(
    message: string,
    error: unknown,
    request?: Request,
    extra: Record<string, unknown> = {}
  ): void {
    this.error(message, {
      ...this.requestContext(request, {
        includeQuery: true,
        includeParams: true,
        includeBody: true,
      }),
      ...extra,
      err: error,
    });
  }

  registerProcessHandlers(): void {
    if (AppLogger.processHandlersRegistered) return;
    AppLogger.processHandlersRegistered = true;

    process.on("unhandledRejection", (reason) => {
      this.logError("process.unhandledRejection", reason);
    });

    process.on("uncaughtException", (error) => {
      this.logError("process.uncaughtException", error);
      process.exit(1);
    });
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if ((LEVELS[level] ?? LEVELS.info) < this.minLevel) {
      return;
    }

    const payload: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      msg: message,
    };

    if (context && Object.keys(context).length > 0) {
      payload.ctx = this.sanitize(context);
    }

    console.log(this.safeStringify(payload));
  }

  private sanitize(value: unknown, depth = 0): unknown {
    if (value === null || value === undefined) return value;
    if (depth > MAX_DEPTH) return "<max_depth>";

    if (value instanceof Error) {
      return this.serializeError(value);
    }

    if (typeof value === "string") {
      return value.length > MAX_STRING_LENGTH
        ? `${value.slice(0, MAX_STRING_LENGTH)}...<truncated>`
        : value;
    }

    if (typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "bigint") return Number(value);
    if (Buffer.isBuffer(value)) return `<buffer:${value.length}>`;

    if (Array.isArray(value)) {
      const limit = Math.min(value.length, MAX_ARRAY);
      const out = value.slice(0, limit).map((item) => this.sanitize(item, depth + 1));
      if (value.length > limit) out.push(`<${value.length - limit} more>`);
      return out;
    }

    if (this.isPlainObject(value)) {
      const out: Record<string, unknown> = {};
      const keys = Object.keys(value);
      const limit = Math.min(keys.length, MAX_KEYS);
      for (const key of keys.slice(0, limit)) {
        out[key] = this.shouldRedact(key)
          ? "[REDACTED]"
          : this.sanitize(value[key], depth + 1);
      }
      if (keys.length > limit) out._truncated_keys = keys.length - limit;
      return out;
    }

    try {
      if (typeof value === "symbol") {
        return value.toString();
      }
      return Object.prototype.toString.call(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }

  private truncateString(value: string): string {
    if (value.length <= MAX_STRING_LENGTH) return value;
    return `${value.slice(0, MAX_STRING_LENGTH)}...<truncated>`;
  }

  private safeStringify(payload: Record<string, unknown>): string {
    const seen = new WeakSet<object>();
    return JSON.stringify(payload, (_key, value: unknown) => {
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
      }
      return value;
    });
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== "object") return false;
    const proto: unknown = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  private shouldRedact(key: string): boolean {
    const normalized = key.toLowerCase();
    return REDACT_KEYS.some((needle) => normalized.includes(needle));
  }

  private serializeError(error: Error): Record<string, unknown> {
    const err: Error & {
      code?: string;
      errno?: number;
      sqlState?: string;
      sqlMessage?: string;
      cause?: unknown;
    } = error;

    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
      code: err.code,
      errno: err.errno,
      sqlState: err.sqlState,
      sqlMessage: err.sqlMessage,
      cause:
        err.cause instanceof Error
          ? this.serializeError(err.cause)
          : typeof err.cause === "string" ||
              typeof err.cause === "number" ||
              typeof err.cause === "boolean"
            ? err.cause
            : undefined,
    };
  }
}

export { AppLogger as AppLoggerService };
