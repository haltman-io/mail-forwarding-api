"use strict";

/**
 * @fileoverview Auth cookie helpers.
 */

const ACCESS_COOKIE_NAME = "__Host-access";
const REFRESH_COOKIE_NAME = "__Host-refresh";

function parseCookiesHeader(headerValue) {
  const out = {};
  const raw = String(headerValue || "");
  if (!raw) return out;

  for (const chunk of raw.split(";")) {
    const index = chunk.indexOf("=");
    if (index <= 0) continue;
    const key = chunk.slice(0, index).trim();
    const value = chunk.slice(index + 1).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(value);
  }

  return out;
}

function shouldUseSecureCookies(envName) {
  return String(envName || "").trim().toLowerCase() === "prod";
}

function buildCookieOptions({ maxAgeMs, envName }) {
  return {
    httpOnly: true,
    secure: shouldUseSecureCookies(envName),
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeMs,
  };
}

function readCookie(req, name) {
  const cookies = parseCookiesHeader(req?.headers?.cookie || "");
  return String(cookies[name] || "").trim();
}

function setAccessCookie(res, token, options) {
  res.cookie(ACCESS_COOKIE_NAME, token, options);
}

function setRefreshCookie(res, token, options) {
  res.cookie(REFRESH_COOKIE_NAME, token, options);
}

function clearAuthCookies(res, envName) {
  const cookieOptions = buildCookieOptions({ maxAgeMs: 0, envName });
  if (typeof res.clearCookie === "function") {
    res.clearCookie(ACCESS_COOKIE_NAME, cookieOptions);
    res.clearCookie(REFRESH_COOKIE_NAME, cookieOptions);
    return;
  }

  res.cookie(ACCESS_COOKIE_NAME, "", { ...cookieOptions, expires: new Date(0) });
  res.cookie(REFRESH_COOKIE_NAME, "", { ...cookieOptions, expires: new Date(0) });
}

module.exports = {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  buildCookieOptions,
  clearAuthCookies,
  parseCookiesHeader,
  readCookie,
  setAccessCookie,
  setRefreshCookie,
  shouldUseSecureCookies,
};
