import type { CookieOptions, Request, Response } from "express";
import { EventEmitter } from "node:events";

export type MockResponse = Response & {
  body: unknown;
  statusCode: number;
  headersMap: Map<string, string>;
  cookies: Array<{ name: string; value: string; options: CookieOptions }>;
  clearedCookies: Array<{ name: string; options: CookieOptions }>;
};

function serializeMockValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  return "";
}

export function createMockRequest(
  overrides: Partial<Request> & {
    body?: Record<string, unknown>;
    headers?: Record<string, unknown>;
    method?: string;
    params?: Record<string, unknown>;
    path?: string;
    query?: Record<string, unknown>;
  } = {},
): Request {
  const rawHeaders = Object.entries(overrides.headers ?? {}).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      acc[key.toLowerCase()] = String(value ?? "");
      return acc;
    },
    {},
  );

  const request = {
    method: overrides.method ?? "GET",
    path: overrides.path ?? "/",
    query: (overrides.query ?? {}) as Record<string, unknown>,
    body: (overrides.body ?? {}) as Record<string, unknown>,
    params: (overrides.params ?? {}) as Record<string, unknown>,
    ip: String(overrides.ip ?? "127.0.0.1"),
    headers: rawHeaders,
    header(name: string): string | undefined {
      return rawHeaders[name.toLowerCase()];
    },
    get(name: string): string | undefined {
      return rawHeaders[name.toLowerCase()];
    },
    is(type: string): boolean {
      const contentType = rawHeaders["content-type"] ?? "";
      return contentType.toLowerCase().includes(type.toLowerCase());
    },
  } as unknown as Request;

  return Object.assign(request, overrides);
}

export function createMockResponse(): MockResponse {
  const headersMap = new Map<string, string>();
  const emitter = new EventEmitter();
  const response = emitter as unknown as MockResponse;

  response.body = undefined;
  response.statusCode = 200;
  response.headersMap = headersMap;
  response.cookies = [];
  response.clearedCookies = [];
  response.status = (code: number) => {
    response.statusCode = code;
    return response;
  };
  response.json = (payload: unknown) => {
    response.body = payload;
    return response;
  };
  response.send = (payload: unknown) => {
    response.body = payload;
    return response;
  };
  response.end = () => response;
  response.set = (name: string, value?: string | string[]) => {
    const resolvedValue = Array.isArray(value) ? value.join(",") : String(value ?? "");
    headersMap.set(name.toLowerCase(), resolvedValue);
    return response;
  };
  response.setHeader = (
    name: string,
    value: string | number | readonly string[],
  ) => {
    const resolvedValue = Array.isArray(value) ? value.join(",") : String(value);
    headersMap.set(name.toLowerCase(), resolvedValue);
    return response;
  };
  response.getHeader = (name: string) => headersMap.get(name.toLowerCase());
  response.cookie = (name: string, value: unknown, options?: CookieOptions) => {
    response.cookies.push({
      name,
      value: serializeMockValue(value),
      options: { ...(options || {}) } as CookieOptions,
    });
    return response;
  };
  response.clearCookie = (name: string, options?: CookieOptions) => {
    response.clearedCookies.push({
      name,
      options: { ...(options || {}) } as CookieOptions,
    });
    return response;
  };

  return response;
}
