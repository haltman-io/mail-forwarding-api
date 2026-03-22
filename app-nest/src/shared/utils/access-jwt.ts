import crypto from "node:crypto";

export interface AccessJwtClaims {
  sub: string;
  sid: string;
  jti: string;
  iss: string;
  aud: string;
  iat: number;
  nbf: number;
  exp: number;
}

export interface AccessJwtSettings {
  jwtAccessPrivateKey: string;
  jwtAccessKid: string;
  jwtAccessVerificationKeys: Record<string, string>;
  jwtAccessIssuer: string;
  jwtAccessAudience: string;
  jwtAccessTtlSeconds: number;
  jwtAccessClockSkewSeconds: number;
}

const JWT_TYP = "JWT";
const JWT_ALG = "EdDSA";

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function parseBase64urlJson(value: string): Record<string, unknown> {
  const json = Buffer.from(String(value || ""), "base64url").toString("utf8");
  return JSON.parse(json) as Record<string, unknown>;
}

function toPem(value: string): string {
  return String(value || "").replace(/\\n/g, "\n").trim();
}

function nowSeconds(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000);
}

export function mintAccessJwt(
  settings: AccessJwtSettings,
  payload: { userId: number | string; sessionFamilyId: string },
): { token: string; claims: AccessJwtClaims } {
  const kid = String(settings.jwtAccessKid || "").trim();
  if (!kid) throw new Error("missing_JWT_ACCESS_KID");

  const privateKeyPem = toPem(settings.jwtAccessPrivateKey);
  if (!privateKeyPem) throw new Error("missing_JWT_ACCESS_PRIVATE_KEY");

  const now = nowSeconds();
  const ttlSeconds = Number(settings.jwtAccessTtlSeconds ?? 600);
  const header = {
    alg: JWT_ALG,
    typ: JWT_TYP,
    kid,
  };
  const claims: AccessJwtClaims = {
    sub: String(payload.userId),
    sid: String(payload.sessionFamilyId),
    jti: crypto.randomUUID(),
    iss: String(settings.jwtAccessIssuer || ""),
    aud: String(settings.jwtAccessAudience || ""),
    iat: now,
    nbf: now,
    exp: now + ttlSeconds,
  };

  const encodedHeader = base64urlJson(header);
  const encodedPayload = base64urlJson(claims);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.sign(
    null,
    Buffer.from(signingInput, "utf8"),
    crypto.createPrivateKey(privateKeyPem),
  );

  return {
    token: `${signingInput}.${signature.toString("base64url")}`,
    claims,
  };
}

export function verifyAccessJwt(
  settings: AccessJwtSettings,
  token: unknown,
  options: { nowMs?: number } = {},
): { header: Record<string, unknown>; claims: AccessJwtClaims } {
  const raw = typeof token === "string" ? token.trim() : "";
  if (!raw) throw new Error("missing_token");

  const parts = raw.split(".");
  if (parts.length !== 3) throw new Error("invalid_token_format");

  const [encodedHeader = "", encodedPayload = "", encodedSignature = ""] = parts;

  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = parseBase64urlJson(encodedHeader);
    claims = parseBase64urlJson(encodedPayload);
  } catch {
    throw new Error("invalid_token_format");
  }

  if (header.typ !== JWT_TYP) throw new Error("invalid_token_type");
  if (header.alg !== JWT_ALG) throw new Error("invalid_token_algorithm");

  const kid = typeof header.kid === "string" ? header.kid.trim() : "";
  if (!kid) throw new Error("missing_token_kid");

  const publicKeyPem = toPem(settings.jwtAccessVerificationKeys?.[kid] || "");
  if (!publicKeyPem) throw new Error("unknown_token_kid");

  const signature = Buffer.from(encodedSignature, "base64url");
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const isValid = crypto.verify(
    null,
    Buffer.from(signingInput, "utf8"),
    crypto.createPublicKey(publicKeyPem),
    signature,
  );

  if (!isValid) throw new Error("invalid_token_signature");

  const skew = Number(settings.jwtAccessClockSkewSeconds ?? 60);
  const now = nowSeconds(options.nowMs);
  const normalizedClaims = claims as unknown as AccessJwtClaims;

  if (String(normalizedClaims.iss || "") !== String(settings.jwtAccessIssuer || "")) {
    throw new Error("invalid_token_issuer");
  }
  if (String(normalizedClaims.aud || "") !== String(settings.jwtAccessAudience || "")) {
    throw new Error("invalid_token_audience");
  }
  if (!String(normalizedClaims.sub || "").trim()) throw new Error("invalid_token_subject");
  if (!String(normalizedClaims.sid || "").trim()) throw new Error("invalid_token_sid");
  if (!String(normalizedClaims.jti || "").trim()) throw new Error("invalid_token_jti");

  const iat = Number(normalizedClaims.iat);
  const nbf = Number(normalizedClaims.nbf);
  const exp = Number(normalizedClaims.exp);
  if (!Number.isFinite(iat) || !Number.isFinite(nbf) || !Number.isFinite(exp)) {
    throw new Error("invalid_token_timestamps");
  }

  if (nbf - skew > now) throw new Error("token_not_yet_valid");
  if (exp + skew < now) throw new Error("token_expired");

  return {
    header,
    claims: normalizedClaims,
  };
}
