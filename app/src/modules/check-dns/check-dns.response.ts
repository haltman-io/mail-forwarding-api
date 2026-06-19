export type CheckDnsStatus = "PENDING" | "ACTIVE" | "EXPIRED" | "FAILED";
export type CheckDnsRequestType = "UI" | "EMAIL";

export interface CheckDnsRequestPayload {
  id: number;
  target: string;
  type: CheckDnsRequestType;
  status: CheckDnsStatus;
  expires_at: string;
  [key: string]: unknown;
}

export interface CheckDnsMissingRecord {
  key?: string;
  type?: string;
  name?: string;
  expected?: unknown;
  found?: unknown[];
  ok?: boolean;
  found_truncated?: boolean;
  [key: string]: unknown;
}

export interface CheckDnsStatusSection {
  status: CheckDnsStatus;
  id?: number;
  created_at?: string;
  expires_at?: string;
  last_checked_at?: string;
  next_check_at?: string;
  missing?: CheckDnsMissingRecord[];
  [key: string]: unknown;
}

export interface CheckDnsStatusPayload {
  target: string;
  normalized_target?: string;
  summary?: {
    has_ui?: boolean;
    has_email?: boolean;
    overall_status?: CheckDnsStatus;
    expires_at_min?: string | null;
    last_checked_at_max?: string | null;
    next_check_at_min?: string | null;
    [key: string]: unknown;
  };
  ui?: CheckDnsStatusSection;
  email?: CheckDnsStatusSection;
  [key: string]: unknown;
}

export type CheckDnsParsedPayload =
  | { ok: true; value: CheckDnsRequestPayload | CheckDnsStatusPayload }
  | { ok: false; reason: string };

const CHECK_DNS_STATUSES = new Set(["PENDING", "ACTIVE", "EXPIRED", "FAILED"]);
const CHECK_DNS_TYPES = new Set(["UI", "EMAIL"]);

export function parseCheckDnsPayload(payload: unknown): CheckDnsParsedPayload {
  if (!isRecord(payload)) {
    return { ok: false, reason: "payload_not_object" };
  }

  if (isRequestPayloadShape(payload)) {
    return { ok: true, value: payload as unknown as CheckDnsRequestPayload };
  }

  if (isStatusPayloadShape(payload)) {
    return { ok: true, value: payload as unknown as CheckDnsStatusPayload };
  }

  return { ok: false, reason: "unknown_payload_shape" };
}

function isRequestPayloadShape(payload: Record<string, unknown>): boolean {
  return (
    typeof payload.id === "number" &&
    typeof payload.target === "string" &&
    typeof payload.type === "string" &&
    CHECK_DNS_TYPES.has(payload.type) &&
    typeof payload.status === "string" &&
    CHECK_DNS_STATUSES.has(payload.status) &&
    typeof payload.expires_at === "string"
  );
}

function isStatusPayloadShape(payload: Record<string, unknown>): boolean {
  if (typeof payload.target !== "string") return false;

  if (payload.summary !== undefined) {
    if (!isRecord(payload.summary)) return false;
    const overallStatus = payload.summary.overall_status;
    if (
      overallStatus !== undefined &&
      (typeof overallStatus !== "string" || !CHECK_DNS_STATUSES.has(overallStatus))
    ) {
      return false;
    }
  }

  if (payload.ui !== undefined && !isStatusSection(payload.ui)) return false;
  if (payload.email !== undefined && !isStatusSection(payload.email)) return false;

  return Boolean(payload.summary || payload.ui || payload.email);
}

function isStatusSection(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.status !== "string" || !CHECK_DNS_STATUSES.has(value.status)) {
    return false;
  }

  if (value.missing !== undefined) {
    if (!Array.isArray(value.missing)) return false;
    if (!value.missing.every((item) => isRecord(item))) return false;
  }

  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
