import crypto from "node:crypto";

export function sha256Buffer(value: string): Buffer {
  return crypto.createHash("sha256").update(String(value), "utf8").digest();
}
