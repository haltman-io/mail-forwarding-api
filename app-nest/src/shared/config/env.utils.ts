export function getString(key: string, fallback = ""): string {
  const value = process.env[key];
  if (value === undefined || value === null) return fallback;
  return String(value);
}

export function getInt(key: string, fallback: number): number {
  const raw = getString(key, "").trim();
  if (!raw) return fallback;

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getBool(key: string, fallback = false): boolean {
  const raw = getString(key, "").trim().toLowerCase();
  if (!raw) return fallback;

  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

export function getStringList(key: string, fallback: string[] = []): string[] {
  const raw = getString(key, "").trim();
  if (!raw) return fallback;

  return Array.from(
    new Set(
      raw
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}

export function getJsonObject(
  key: string,
  fallback: Record<string, string> = {},
): Record<string, string> {
  const raw = getString(key, "").trim();
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return fallback;
    }

    return Object.entries(parsed as Record<string, unknown>).reduce<Record<string, string>>(
      (acc, [childKey, value]) => {
        if (typeof value === "string" && value.trim()) {
          acc[String(childKey)] = value;
        }
        return acc;
      },
      {},
    );
  } catch {
    return fallback;
  }
}

export function requireNonEmpty(key: string): void {
  if (!getString(key, "").trim()) {
    throw new Error(`missing_${key}`);
  }
}

export function requirePositiveInt(key: string): void {
  const raw = getString(key, "").trim();
  if (!raw) return;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid_${key}`);
  }
}
