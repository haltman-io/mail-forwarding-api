"use strict";

/**
 * @fileoverview IP helpers for storing addresses in VARBINARY(16).
 */

const net = require("net");

/**
 * Pack IPv4/IPv6 string into 16 bytes (VARBINARY(16)).
 * - IPv4 => ::ffff:a.b.c.d mapped
 * - IPv6 => 16 bytes
 * - Invalid => null
 * @param {string} ipString
 * @returns {Buffer | null}
 */
function packIp16(ipString) {
  if (typeof ipString !== "string") return null;
  const ip = ipString.trim();
  if (!ip) return null;

  const family = net.isIP(ip);

  if (family === 4) {
    const out = Buffer.alloc(16, 0);
    out[10] = 0xff;
    out[11] = 0xff;

    const parts = ip.split(".");
    if (parts.length !== 4) return null;

    for (let i = 0; i < 4; i++) {
      const n = Number(parts[i]);
      if (!Number.isInteger(n) || n < 0 || n > 255) return null;
      out[12 + i] = n;
    }
    return out;
  }

  if (family === 6) {
    let s = ip.toLowerCase();

    // IPv4 embedded at the end: ::ffff:1.2.3.4 or 2001::1.2.3.4
    const lastColon = s.lastIndexOf(":");
    if (lastColon !== -1 && s.slice(lastColon + 1).includes(".")) {
      const v4 = s.slice(lastColon + 1);
      const packedV4 = packIp16(v4);
      if (!packedV4) return null;

      const v4bytes = packedV4.slice(12, 16);
      s =
        s.slice(0, lastColon) +
        `:${v4bytes.readUInt16BE(0).toString(16)}:${v4bytes.readUInt16BE(2).toString(16)}`;
    }

    if (s.includes("::")) {
      const [head, tail] = s.split("::");
      const headParts = head ? head.split(":").filter(Boolean) : [];
      const tailParts = tail ? tail.split(":").filter(Boolean) : [];
      const missing = 8 - (headParts.length + tailParts.length);
      if (missing < 0) return null;

      const parts = [...headParts, ...Array(missing).fill("0"), ...tailParts];
      return ipv6PartsToBuffer(parts);
    }

    const parts = s.split(":");
    if (parts.length !== 8) return null;
    return ipv6PartsToBuffer(parts);
  }

  return null;
}

function ipv6PartsToBuffer(parts) {
  if (!Array.isArray(parts) || parts.length !== 8) return null;
  const out = Buffer.alloc(16);

  for (let i = 0; i < 8; i++) {
    const part = parts[i];
    if (typeof part !== "string" || part.length < 1 || part.length > 4) return null;
    const num = parseInt(part, 16);
    if (!Number.isFinite(num) || num < 0 || num > 0xffff) return null;
    out.writeUInt16BE(num, i * 2);
  }
  return out;
}

module.exports = { packIp16 };
