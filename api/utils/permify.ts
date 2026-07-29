/**
 * Permify ReBAC client (feat-mw-edge-authz).
 *
 * Thin REST client for `POST /v1/tenants/{tenant}/permissions/check` with an
 * in-process circuit breaker that falls back to the existing ABAC checks
 * (api/utils/rbac.ts, api/utils/datasets.ts) when Permify is unreachable or
 * erroring. Enabled only when `PERMIFY_URL` is set — otherwise every call
 * goes straight to the ABAC fallback, so behavior without Permify is
 * byte-identical to before.
 *
 * Env:
 *   PERMIFY_URL        e.g. http://localhost:3476 (compose) or
 *                      http://permify.authz.svc.cluster.local:3476 (k8s)
 *   PERMIFY_TENANT_ID  default "t1"
 *   PERMIFY_TIMEOUT_MS default 800
 *
 * The decision's engine is returned to the caller (`permify` |
 * `abac-fallback`) so call sites can record `meta.authz_engine` in AUDIT
 * details — never in API responses.
 */

export type AuthzEngine = "permify" | "abac-fallback";

export interface AccessSubject {
  /** Platform user id (numeric) or stable external id. */
  id: string | number;
  /** Optional platform role — passed as subject relation context. */
  role?: string;
}

export interface AccessEntity {
  /** Permify entity type: dataset | law | opportunity | jurisdiction. */
  type: string;
  id: string;
  /** Attributes forwarded to the check (e.g. classification). */
  attributes?: Record<string, string | number | boolean>;
}

export interface AccessDecision {
  allowed: boolean;
  engine: AuthzEngine;
  /** Present when the Permify path failed and the fallback was used. */
  permifyError?: string;
}

export type AbacFallback = (
  subject: AccessSubject,
  action: string,
  entity: AccessEntity,
) => Promise<boolean> | boolean;

/* ------------------------------------------------------------------ */
/* Circuit breaker                                                     */
/* ------------------------------------------------------------------ */

const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 30_000;

let consecutiveFailures = 0;
let breakerOpenedAt = 0;

function breakerOpen(): boolean {
  if (consecutiveFailures < FAILURE_THRESHOLD) return false;
  if (Date.now() - breakerOpenedAt >= COOLDOWN_MS) return false; // half-open probe
  return true;
}

function recordSuccess(): void {
  consecutiveFailures = 0;
}

function recordFailure(): void {
  consecutiveFailures += 1;
  if (consecutiveFailures >= FAILURE_THRESHOLD) breakerOpenedAt = Date.now();
}

/** Test hook: reset breaker state. */
export function resetPermifyBreaker(): void {
  consecutiveFailures = 0;
  breakerOpenedAt = 0;
}

export function permifyEnabled(): boolean {
  return Boolean(process.env.PERMIFY_URL);
}

function tenantId(): string {
  return process.env.PERMIFY_TENANT_ID || "t1";
}

/* ------------------------------------------------------------------ */
/* REST check                                                          */
/* ------------------------------------------------------------------ */

interface PermifyCheckResponse {
  can?: string; // "RESULT_ALLOWED" | "RESULT_DENIED"
}

/** Raw Permify permissions/check call. Exported for tests. */
export async function permifyCheck(
  subject: AccessSubject,
  action: string,
  entity: AccessEntity,
): Promise<boolean> {
  const base = (process.env.PERMIFY_URL ?? "").replace(/\/$/, "");
  if (!base) throw new Error("PERMIFY_URL is not configured");
  const timeoutMs = Number(process.env.PERMIFY_TIMEOUT_MS ?? 800);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(
      `${base}/v1/tenants/${encodeURIComponent(tenantId())}/permissions/check`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          metadata: { snap_token: "", schema_version: "", depth: 20 },
          entity: { type: entity.type, id: entity.id },
          permission: action,
          subject: { type: "user", id: String(subject.id) },
          arguments: [],
        }),
      },
    );
    if (!resp.ok) throw new Error(`permify check HTTP ${resp.status}`);
    const body = (await resp.json()) as PermifyCheckResponse;
    return body.can === "RESULT_ALLOWED";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Primary authorization entry point — mirrors the rbac helper style:
 * `checkAccess(user, action, entity)` → decision. Permify is tried first
 * (when configured and the breaker is closed); any failure falls back to
 * the provided ABAC check and the decision is tagged `abac-fallback`.
 */
export async function checkAccess(
  subject: AccessSubject,
  action: string,
  entity: AccessEntity,
  fallback: AbacFallback,
): Promise<AccessDecision> {
  if (permifyEnabled() && !breakerOpen()) {
    try {
      const allowed = await permifyCheck(subject, action, entity);
      recordSuccess();
      return { allowed, engine: "permify" };
    } catch (err) {
      recordFailure();
      const allowed = await fallback(subject, action, entity);
      return {
        allowed,
        engine: "abac-fallback",
        permifyError: err instanceof Error ? err.message : String(err),
      };
    }
  }
  const allowed = await fallback(subject, action, entity);
  return { allowed, engine: "abac-fallback" };
}
