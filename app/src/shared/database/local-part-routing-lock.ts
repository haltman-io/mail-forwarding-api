import { createHash } from "node:crypto";

import type { PoolConnection } from "mariadb";

import { PublicHttpException } from "../errors/public-http.exception.js";

const LOCK_TIMEOUT_SECONDS = 5;
const REGISTERED_LOCKS = Symbol("registeredLocalPartRoutingLocks");

interface LockAcquireRow {
  acquired: number | string | bigint | null;
}

function localPartLockName(localPart: string): string {
  const normalized = String(localPart || "").trim().toLowerCase();
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 40);
  return `mfapi:localpart:${digest}`;
}

type LockableConnection = PoolConnection & {
  [REGISTERED_LOCKS]?: Set<string>;
};

function getRegisteredLocks(connection: PoolConnection): Set<string> {
  const lockable = connection as LockableConnection;
  lockable[REGISTERED_LOCKS] ??= new Set<string>();
  return lockable[REGISTERED_LOCKS];
}

async function acquireLocalPartRoutingLock(
  connection: PoolConnection,
  localPart: string,
): Promise<void> {
  const lockName = localPartLockName(localPart);
  const registeredLocks = getRegisteredLocks(connection);
  if (registeredLocks.has(lockName)) return;

  const rows: LockAcquireRow[] = await connection.query("SELECT GET_LOCK(?, ?) AS acquired", [
    lockName,
    LOCK_TIMEOUT_SECONDS,
  ]);
  const acquired = Number(rows[0]?.acquired ?? 0);

  if (acquired !== 1) {
    throw new PublicHttpException(409, {
      ok: false,
      error: "alias_state_changed",
      reason: "local_part_busy",
    });
  }

  registeredLocks.add(lockName);
}

export async function releaseLocalPartRoutingLocks(connection: PoolConnection): Promise<void> {
  const registeredLocks = getRegisteredLocks(connection);
  const lockNames = [...registeredLocks].reverse();

  for (const lockName of lockNames) {
    await connection.query("SELECT RELEASE_LOCK(?) AS released", [lockName]);
    registeredLocks.delete(lockName);
  }
}

export async function withLocalPartRoutingLock<T>(
  connection: PoolConnection,
  localPart: string,
  work: () => Promise<T>,
): Promise<T> {
  // Named locks are connection-scoped; DatabaseService.withTransaction releases
  // registered locks after commit/rollback, before returning the connection.
  await acquireLocalPartRoutingLock(connection, localPart);
  return work();
}
