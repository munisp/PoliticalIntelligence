import { and, eq, inArray } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import type { TrpcContext } from "../context";
import { apiError } from "./envelope";
import {
  assertJurisdictionAccess,
  resolveRole,
  type AuthedCtx,
} from "./rbac";

/**
 * Dataset/document-level ABAC (SEC-3).
 *
 * `dataset_policies` rows classify datasets as:
 *   public     — anyone, including the anonymous public facade;
 *   internal   — any authenticated platform user;
 *   restricted — only roles in allowed_roles (platform_admin always
 *                allowed); when the policy pins a jurisdiction the actor
 *                also needs read access to it (user_jurisdictions grant).
 *
 * Resolution: an exact (dataset_id, entity_type) row wins over the
 * entity-type wildcard ("*"). No policy ⇒ default-open (platform datasets
 * are public reference data unless a steward classifies them).
 *
 * Lists use `filterDatasets` (restricted rows are HIDDEN); single-row reads
 * use `assertDatasetRead` (403 FORBIDDEN).
 */

export interface DatasetRef {
  entityType: string;
  datasetId: string;
  jurisdictionId?: string | null;
}

/** Resolve the effective policy for a dataset (exact match beats "*"). */
export async function datasetPolicyFor(
  entityType: string,
  datasetId: string,
): Promise<schema.DatasetPolicy | null> {
  const rows = await getDb()
    .select()
    .from(schema.datasetPolicies)
    .where(
      and(
        eq(schema.datasetPolicies.entityType, entityType),
        inArray(schema.datasetPolicies.datasetId, [datasetId, "*"]),
      ),
    );
  return (
    rows.find((r) => r.datasetId === datasetId) ??
    rows.find((r) => r.datasetId === "*") ??
    null
  );
}

/**
 * Pure ABAC decision (the pre-Permify path), used as the circuit-breaker
 * fallback and whenever PERMIFY_URL is unset.
 */
async function canReadDatasetAbac(
  ctx: TrpcContext,
  ref: DatasetRef,
): Promise<boolean> {
  const policy = await datasetPolicyFor(ref.entityType, ref.datasetId);
  if (!policy || policy.classification === "public") return true;
  if (!ctx.user) return false; // internal/restricted need a session
  if (policy.classification === "internal") return true;
  // restricted
  const role = resolveRole(ctx.user);
  const allowed = (policy.allowedRoles as string[] | null) ?? [];
  if (role !== "platform_admin" && !allowed.includes(role)) return false;
  if (policy.jurisdictionId) {
    try {
      await assertJurisdictionAccess(
        ctx as AuthedCtx,
        policy.jurisdictionId,
        "read",
      );
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Record the authorization engine in the AUDIT TRAIL (never in responses —
 * SEC: decision internals must not leak to clients). Fire-and-forget; only
 * fires on the Permify path, and only for denies or degraded decisions, so
 * the steady-state audit volume is unchanged.
 */
function auditAuthzEngine(
  ctx: TrpcContext,
  ref: DatasetRef,
  decision: { allowed: boolean; engine: string; permifyError?: string },
): void {
  if (decision.engine === "permify" && decision.allowed) return;
  void import("../queries/audit")
    .then(({ insertAuditEvent }) =>
      insertAuditEvent({
        actorId: ctx.user?.id ?? null,
        action: "datasets.authz.checked",
        entityType: ref.entityType,
        entityId: ref.datasetId,
        scopes: null,
        requestId: null,
        correlationId: null,
        payload: {
          decision: decision.allowed ? "allow" : "deny",
          meta: {
            authz_engine: decision.engine,
            permify_error: decision.permifyError ?? null,
          },
        },
      }),
    )
    .catch(() => {
      /* audit must never break a read */
    });
}

/**
 * True when the caller may read the dataset under its policy.
 *
 * Authorization seam (feat-mw-edge-authz): when `PERMIFY_URL` is set and a
 * session exists, the decision goes to Permify first
 * (`dataset:<id> read @ user:<userId>`); the in-process circuit breaker in
 * api/utils/permify.ts degrades to the ABAC check above on any Permify
 * failure, tagging the decision `abac-fallback`. The engine used is
 * recorded in audit details as `meta.authz_engine`.
 */
export async function canReadDataset(
  ctx: TrpcContext,
  ref: DatasetRef,
): Promise<boolean> {
  const { permifyEnabled, checkAccess } = await import("./permify");
  if (!permifyEnabled() || !ctx.user) {
    return canReadDatasetAbac(ctx, ref);
  }
  const policy = await datasetPolicyFor(ref.entityType, ref.datasetId);
  const decision = await checkAccess(
    { id: ctx.user.id, role: resolveRole(ctx.user) },
    "read",
    {
      type: "dataset",
      id: ref.datasetId,
      attributes: { classification: policy?.classification ?? "restricted" },
    },
    () => canReadDatasetAbac(ctx, ref),
  );
  auditAuthzEngine(ctx, ref, decision);
  return decision.allowed;
}

/** Throw FORBIDDEN when the caller may not read the dataset. */
export async function assertDatasetRead(
  ctx: TrpcContext,
  ref: DatasetRef,
): Promise<void> {
  if (await canReadDataset(ctx, ref)) return;
  const policy = await datasetPolicyFor(ref.entityType, ref.datasetId);
  throw apiError(ctx, {
    http: "FORBIDDEN",
    code: "DATASET_ACCESS_DENIED",
    message: `Dataset ${ref.datasetId} is ${policy?.classification ?? "restricted"} — access denied`,
    retryable: false,
    details: {
      dataset_id: ref.datasetId,
      entity_type: ref.entityType,
      classification: policy?.classification ?? null,
    },
  });
}

/** Policy lookup keyed `entityType:datasetId`, including "*" wildcards. */
async function policiesByKey(
  refs: DatasetRef[],
): Promise<Map<string, schema.DatasetPolicy>> {
  const entityTypes = [...new Set(refs.map((r) => r.entityType))];
  const datasetIds = [...new Set(refs.map((r) => r.datasetId))];
  const rows = await getDb()
    .select()
    .from(schema.datasetPolicies)
    .where(
      and(
        inArray(schema.datasetPolicies.entityType, entityTypes),
        inArray(schema.datasetPolicies.datasetId, [...datasetIds, "*"]),
      ),
    );
  // Exact dataset match wins over the wildcard for each entity type.
  const map = new Map<string, schema.DatasetPolicy>();
  for (const row of rows.sort((a) => (a.datasetId === "*" ? 1 : -1))) {
    map.set(`${row.entityType}:${row.datasetId}`, row);
  }
  return map;
}

function resolvePolicy(
  map: Map<string, schema.DatasetPolicy>,
  ref: DatasetRef,
): schema.DatasetPolicy | null {
  return (
    map.get(`${ref.entityType}:${ref.datasetId}`) ??
    map.get(`${ref.entityType}:*`) ??
    null
  );
}

/**
 * Hidden-not-forbidden list filtering: returns the visible items plus the
 * number of restricted rows dropped (for response meta transparency).
 * Policies and the actor's jurisdiction grants are loaded once per call.
 */
export async function filterDatasets<T>(
  ctx: TrpcContext,
  items: T[],
  toRef: (item: T) => DatasetRef,
): Promise<{ visible: T[]; hidden: number }> {
  const refs = items.map(toRef);
  const policies = await policiesByKey(refs);
  // Pre-resolve the actor's role + jurisdiction grants (once).
  let role: string | null = null;
  let grants: Set<string> | null = null;
  if (ctx.user) {
    role = resolveRole(ctx.user);
    if (role !== "platform_admin" && role !== "executive") {
      const { jurisdictionsForUser } = await import("../queries/users");
      grants = new Set(
        (await jurisdictionsForUser(ctx.user.id)).map((g) => g.jurisdictionId),
      );
    }
  }
  const check = (ref: DatasetRef): boolean => {
    const policy = resolvePolicy(policies, ref);
    if (!policy || policy.classification === "public") return true;
    if (!ctx.user || !role) return false;
    if (policy.classification === "internal") return true;
    const allowed = (policy.allowedRoles as string[] | null) ?? [];
    if (role !== "platform_admin" && !allowed.includes(role)) return false;
    if (policy.jurisdictionId) {
      if (role === "platform_admin" || role === "executive") return true;
      return grants?.has(policy.jurisdictionId) ?? false;
    }
    return true;
  };
  const visible: T[] = [];
  let hidden = 0;
  for (const item of items) {
    if (check(toRef(item))) visible.push(item);
    else hidden += 1;
  }
  return { visible, hidden };
}
