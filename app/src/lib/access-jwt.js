"use strict";

/**
 * @fileoverview Ed25519 access JWT minting and verification.
 */

const crypto = require("crypto");
const { config } = require("../config");

const JWT_TYP = "JWT";
const JWT_ALG = "EdDSA";

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function parseBase64urlJson(value) {
  const json = Buffer.from(String(value || ""), "base64url").toString("utf8");
  return JSON.parse(json);
}

function toPem(value) {
  return String(value || "").replace(/\\n/g, "\n").trim();
}

function getSigningKey() {
  const pem = toPem(config.jwtAccessPrivateKey);
  if (!pem) throw new Error("missing_JWT_ACCESS_PRIVATE_KEY");
  return crypto.createPrivateKey(pem);
}

function getVerificationKeys() {
  const keys = {};
  const raw = config.jwtAccessVerificationKeys || {};

  for (const [kid, pemValue] of Object.entries(raw)) {
    const pem = toPem(pemValue);
    if (!pem) continue;
    keys[String(kid)] = crypto.createPublicKey(pem);
  }

  return keys;
}

function nowSeconds(nowMs = Date.now()) {
  return Math.floor(nowMs / 1000);
}

/**
 * @param {{ userId: number | string, sessionFamilyId: string }} payload
 * @returns {{ token: string, claims: Record<string, string | number> }}
 */
function mintAccessJwt({ userId, sessionFamilyId }) {
  const kid = String(config.jwtAccessKid || "").trim();
  if (!kid) throw new Error("missing_JWT_ACCESS_KID");

  const now = nowSeconds();
  const ttlSeconds = Number(config.jwtAccessTtlSeconds ?? 600);
  const header = {
    alg: JWT_ALG,
    typ: JWT_TYP,
    kid,
  };
  const claims = {
    sub: String(userId),
    sid: String(sessionFamilyId),
    jti: crypto.randomUUID(),
    iss: String(config.jwtAccessIssuer || ""),
    aud: String(config.jwtAccessAudience || ""),
    iat: now,
    nbf: now,
    exp: now + ttlSeconds,
  };

  const encodedHeader = base64urlJson(header);
  const encodedPayload = base64urlJson(claims);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign(null, Buffer.from(signingInput, "utf8"), getSigningKey());

  return {
    token: `${signingInput}.${signature.toString("base64url")}`,
    claims,
  };
}

/**
 * @param {unknown} token
 * @param {{ nowMs?: number }} [options]
 * @returns {{ header: Record<string, unknown>, claims: Record<string, unknown> }}
 */
function verifyAccessJwt(token, options = {}) {
  const raw = String(token || "").trim();
  if (!raw) throw new Error("missing_token");

  const parts = raw.split(".");
  if (parts.length !== 3) throw new Error("invalid_token_format");

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  let header;
  let claims;

  try {
    header = parseBase64urlJson(encodedHeader);
    claims = parseBase64urlJson(encodedPayload);
  } catch (_) {
    throw new Error("invalid_token_format");
  }

  if (!header || header.typ !== JWT_TYP) throw new Error("invalid_token_type");
  if (header.alg !== JWT_ALG) throw new Error("invalid_token_algorithm");

  const kid = String(header.kid || "").trim();
  if (!kid) throw new Error("missing_token_kid");

  const verificationKeys = getVerificationKeys();
  const publicKey = verificationKeys[kid];
  if (!publicKey) throw new Error("unknown_token_kid");

  const signature = Buffer.from(encodedSignature, "base64url");
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const isValid = crypto.verify(
    null,
    Buffer.from(signingInput, "utf8"),
    publicKey,
    signature
  );

  if (!isValid) throw new Error("invalid_token_signature");

  const skew = Number(config.jwtAccessClockSkewSeconds ?? 60);
  const now = nowSeconds(options.nowMs);
  const iss = String(config.jwtAccessIssuer || "");
  const aud = String(config.jwtAccessAudience || "");

  if (String(claims.iss || "") !== iss) throw new Error("invalid_token_issuer");
  if (String(claims.aud || "") !== aud) throw new Error("invalid_token_audience");
  if (!String(claims.sub || "").trim()) throw new Error("invalid_token_subject");
  if (!String(claims.sid || "").trim()) throw new Error("invalid_token_sid");
  if (!String(claims.jti || "").trim()) throw new Error("invalid_token_jti");

  const iat = Number(claims.iat);
  const nbf = Number(claims.nbf);
  const exp = Number(claims.exp);

  if (!Number.isFinite(iat) || !Number.isFinite(nbf) || !Number.isFinite(exp)) {
    throw new Error("invalid_token_timestamps");
  }

  if (nbf - skew > now) throw new Error("token_not_yet_valid");
  if (exp + skew < now) throw new Error("token_expired");

  return { header, claims };
}

module.exports = {
  mintAccessJwt,
  verifyAccessJwt,
};
