/**
 * Standard response envelope helpers (spec §15.4 / §38).
 * All platform tRPC procedures return:
 *   { data: T, meta: { request_id, correlation_id, api_version }, audit: { actor_id, generated_at } }
 */
export interface EnvelopeMeta {
  request_id: string;
  correlation_id: string;
  api_version: string;
}
export interface EnvelopeAudit {
  /** Actor id as emitted by the API (numeric user id; null for system actors). */
  actor_id: string | number | null;
  /** API emits a Date (superjson) — tolerate ISO strings too. */
  generated_at: string | Date;
}
export interface Envelope<T> {
  data: T;
  meta: EnvelopeMeta;
  audit: EnvelopeAudit;
}

/** Unwrap a tRPC envelope, tolerating procedures that already return raw data. */
export function unwrap<T>(payload: Envelope<T> | T | null | undefined): T {
  if (payload == null) return payload as T;
  if (
    typeof payload === "object" &&
    "data" in (payload as Record<string, unknown>) &&
    "meta" in (payload as Record<string, unknown>)
  ) {
    return (payload as Envelope<T>).data;
  }
  return payload as T;
}

/** Extract the envelope meta (request_id etc.) for evidence drawers / export footers. */
export function envelopeMeta<T>(payload: Envelope<T> | T | null | undefined): EnvelopeMeta | null {
  if (payload == null || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  return "meta" in p ? (p.meta as EnvelopeMeta) : null;
}

/** Map DB snake_case review/approval states to the kebab-case labels used by shared components. */
export function approvalStateLabel(state: string): string {
  return state.replace(/_/g, "-");
}

/** Map kebab-case component states back to DB snake_case. */
export function approvalStateDb(state: string): string {
  return state.replace(/-/g, "_");
}
