import { Injectable } from "@nestjs/common";
import type { PoolConnection } from "mariadb";

import { DatabaseService } from "../../../shared/database/database.service.js";
import { packIp16 } from "../../../shared/utils/ip-pack.js";
import {
  isValidLocalPart,
  isValidDomain,
  normalizeLowerTrim,
} from "../../../shared/validation/mailbox.js";

export interface PendingRow {
  id: number;
  email: string;
  status: string;
  created_at: Date | string;
  expires_at: Date | string;
  send_count: number | string;
  last_sent_at: Date | string | null;
  attempts_confirm: number;
  intent: string;
  alias_name: string;
  alias_domain: string;
}

export interface PendingRequestKey {
  email: string;
  intent: string;
  aliasName: string;
  aliasDomain: string;
}

interface InsertResult {
  affectedRows: number;
  insertId: number | bigint;
}

function runQuery<T>(
  executor: DatabaseService | PoolConnection,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T> {
  return (
    executor as {
      query: (statement: string, values?: readonly unknown[]) => Promise<T>;
    }
  ).query(sql, [...params]);
}

function assertAliasName(name: unknown): string {
  if (typeof name !== "string") throw new Error("invalid_alias_name");
  const value = normalizeLowerTrim(name);
  if (!isValidLocalPart(value)) throw new Error("invalid_alias_name");
  return value;
}

function assertDomain(domain: unknown): string {
  if (typeof domain !== "string") throw new Error("invalid_alias_domain");
  const value = normalizeLowerTrim(domain);
  if (value === "__handle__") return value;
  if (!isValidDomain(value)) throw new Error("invalid_alias_domain");
  return value;
}

function assertIntent(intent: unknown): string {
  if (typeof intent !== "string") throw new Error("invalid_intent");
  const value = intent.trim().toLowerCase();
  if (!value || value.length > 32) throw new Error("invalid_intent");
  return value;
}

function assertTtlMinutes(ttlMinutes: unknown): number {
  const num = Number(ttlMinutes);
  if (!Number.isFinite(num) || num <= 0 || num > 24 * 60) {
    throw new Error("invalid_ttlMinutes");
  }
  return Math.floor(num);
}

function assertTokenHash32(tokenHash32: Buffer): Buffer {
  if (!Buffer.isBuffer(tokenHash32) || tokenHash32.length !== 32) {
    throw new Error("invalid_tokenHash32");
  }
  return tokenHash32;
}

function normalizePendingEmail(email: unknown): string {
  if (typeof email !== "string") throw new Error("invalid_email");
  const value = email.trim().toLowerCase();
  if (!value) throw new Error("invalid_email");
  return value;
}

function confirmationIntentGroup(intent: string): "create" | "unsubscribe" | "handle" {
  if (intent.startsWith("handle_")) return "handle";
  return intent === "unsubscribe" ? "unsubscribe" : "create";
}

@Injectable()
export class EmailConfirmationsRepository {
  constructor(private readonly database: DatabaseService) {}

  async getActivePendingByRequest(payload: PendingRequestKey): Promise<PendingRow | null> {
    const email = normalizePendingEmail(payload.email);
    const normalizedIntent = assertIntent(payload.intent);
    const normalizedAliasName = assertAliasName(payload.aliasName);
    const normalizedAliasDomain = assertDomain(payload.aliasDomain);

    const rows = await this.database.query<PendingRow[]>(
      `SELECT id, email, status, created_at, expires_at,
              send_count, last_sent_at, attempts_confirm,
              intent, alias_name, alias_domain
       FROM email_confirmations
       WHERE email = ?
         AND intent = ?
         AND alias_name = ?
         AND alias_domain = ?
         AND status = 'pending'
         AND expires_at > NOW(6)
       ORDER BY id DESC
       LIMIT 1`,
      [email, normalizedIntent, normalizedAliasName, normalizedAliasDomain],
    );

    return rows[0] ?? null;
  }

  async createPending(payload: {
    email: string;
    tokenHash32: Buffer;
    ttlMinutes: number;
    requestIpStringOrNull: string | null;
    userAgentOrNull: string | null;
    intent: string;
    aliasName: string;
    aliasDomain: string;
  }): Promise<PendingRow | null> {
    const email = normalizePendingEmail(payload.email);
    assertTokenHash32(payload.tokenHash32);
    const ttl = assertTtlMinutes(payload.ttlMinutes);
    const normalizedIntent = assertIntent(payload.intent);
    const normalizedAliasName = assertAliasName(payload.aliasName);
    const normalizedAliasDomain = assertDomain(payload.aliasDomain);
    const intentGroup = confirmationIntentGroup(normalizedIntent);

    return this.database.withTransaction(async (conn: PoolConnection) => {
      const packedIp =
        payload.requestIpStringOrNull && typeof payload.requestIpStringOrNull === "string"
          ? packIp16(payload.requestIpStringOrNull)
          : null;

      await conn.query(
        `UPDATE email_confirmations
         SET status = 'expired'
         WHERE email = ?
           AND status = 'pending'
           AND expires_at <= NOW(6)`,
        [email],
      );

      const conflictingIntents =
        intentGroup === "handle"
          ? [normalizedIntent]
          : intentGroup === "unsubscribe"
            ? ["unsubscribe"]
            : ["subscribe", "subscribe_address"];

      await conn.query(
        `UPDATE email_confirmations
         SET status = 'expired'
         WHERE alias_name = ?
           AND alias_domain = ?
           AND status = 'pending'
           AND expires_at > NOW(6)
           AND intent IN (${conflictingIntents.map(() => "?").join(", ")})`,
        [normalizedAliasName, normalizedAliasDomain, ...conflictingIntents],
      );

      await conn.query(
        `UPDATE email_confirmations
         SET status = 'expired'
         WHERE email = ?
           AND status = 'pending'
           AND expires_at > NOW(6)`,
        [email],
      );

      const result: InsertResult = await conn.query(
        `INSERT INTO email_confirmations (
            email, token_hash, status, created_at, expires_at,
            request_ip, user_agent, send_count, last_sent_at,
            attempts_confirm,
            intent, alias_name, alias_domain
          ) VALUES (
            ?, ?, 'pending', NOW(6), DATE_ADD(NOW(6), INTERVAL ? MINUTE),
            ?, ?, 1, NOW(6),
            0,
            ?, ?, ?
          )`,
        [
          email,
          payload.tokenHash32,
          ttl,
          packedIp,
          payload.userAgentOrNull ?? null,
          normalizedIntent,
          normalizedAliasName,
          normalizedAliasDomain,
        ],
      );

      const rows: PendingRow[] = await conn.query(
        `SELECT id, email, status, created_at, expires_at,
                send_count, last_sent_at, attempts_confirm,
                intent, alias_name, alias_domain
         FROM email_confirmations
         WHERE id = ?
         LIMIT 1`,
        [result.insertId],
      );

      return rows[0] ?? null;
    });
  }

  async rotateTokenForPending(payload: {
    pendingId: number;
    tokenHash32: Buffer;
    ttlMinutes: number;
    requestIpStringOrNull: string | null;
    userAgentOrNull: string | null;
  }): Promise<boolean> {
    assertTokenHash32(payload.tokenHash32);
    const ttl = assertTtlMinutes(payload.ttlMinutes);

    const packedIp =
      payload.requestIpStringOrNull && typeof payload.requestIpStringOrNull === "string"
        ? packIp16(payload.requestIpStringOrNull)
        : null;

    const result = await this.database.query<InsertResult>(
      `UPDATE email_confirmations
       SET token_hash = ?,
           expires_at = DATE_ADD(NOW(6), INTERVAL ? MINUTE),
           request_ip = ?,
           user_agent = ?,
           send_count = send_count + 1,
           last_sent_at = NOW(6)
       WHERE id = ?
         AND status = 'pending'
         AND expires_at > NOW(6)`,
      [
        payload.tokenHash32,
        ttl,
        packedIp,
        payload.userAgentOrNull ?? null,
        payload.pendingId,
      ],
    );

    return Boolean(result && result.affectedRows === 1);
  }

  async getPendingByTokenHash(
    tokenHash32: Buffer,
    connection?: PoolConnection,
    options: { forUpdate?: boolean } = {},
  ): Promise<PendingRow | null> {
    assertTokenHash32(tokenHash32);

    const executor = connection ?? this.database;
    const lockClause = options.forUpdate ? " FOR UPDATE" : "";
    const rows = await runQuery<PendingRow[]>(
      executor,
      `SELECT id, email, status, created_at, expires_at,
              send_count, last_sent_at, attempts_confirm,
              intent, alias_name, alias_domain
       FROM email_confirmations
       WHERE token_hash = ?
         AND status = 'pending'
         AND expires_at > NOW(6)
       ORDER BY id DESC
       LIMIT 1${lockClause}`,
      [tokenHash32],
    );

    return rows[0] ?? null;
  }

  async markConfirmedById(id: number, connection?: PoolConnection): Promise<boolean> {
    const executor = connection ?? this.database;
    const result = await runQuery<InsertResult>(
      executor,
      `UPDATE email_confirmations
       SET status = 'confirmed',
           confirmed_at = NOW(6)
       WHERE id = ?
         AND status = 'pending'
         AND expires_at > NOW(6)`,
      [id],
    );

    return Boolean(result && result.affectedRows === 1);
  }
}
