import { and, desc, eq, gte, inArray, type SQL } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";

/** Alerts visible to a read scope (I1). Newest first. */
export async function listPolicyAlerts(opts: {
  sector?: string;
  jurisdictionId?: string;
  jurisdictionIds?: string[];
  since?: Date;
  limit: number;
}): Promise<schema.PolicyAlert[]> {
  const conds: SQL[] = [];
  if (opts.sector) conds.push(eq(schema.policyAlerts.sector, opts.sector));
  if (opts.jurisdictionId) {
    conds.push(eq(schema.policyAlerts.jurisdictionId, opts.jurisdictionId));
  } else if (opts.jurisdictionIds) {
    if (opts.jurisdictionIds.length === 0) return [];
    // Platform-level alerts (null jurisdiction) are always readable.
    conds.push(inArray(schema.policyAlerts.jurisdictionId, opts.jurisdictionIds));
  }
  if (opts.since) conds.push(gte(schema.policyAlerts.createdAt, opts.since));
  return getDb()
    .select()
    .from(schema.policyAlerts)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.policyAlerts.createdAt))
    .limit(opts.limit);
}

/** Hydrate full alert rows by their natural keys (alertId). */
export async function alertsByIds(alertIds: string[]): Promise<schema.PolicyAlert[]> {
  if (alertIds.length === 0) return [];
  return getDb()
    .select()
    .from(schema.policyAlerts)
    .where(inArray(schema.policyAlerts.alertId, alertIds));
}

export async function existingAlertIds(alertIds: string[]): Promise<Set<string>> {
  if (alertIds.length === 0) return new Set();
  const rows = await getDb()
    .select({ alertId: schema.policyAlerts.alertId })
    .from(schema.policyAlerts)
    .where(inArray(schema.policyAlerts.alertId, alertIds));
  return new Set(rows.map((r) => r.alertId));
}

/** Idempotent insert: skips alertIds already present (natural key). */
export async function insertPolicyAlerts(
  rows: schema.InsertPolicyAlert[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const have = await existingAlertIds(rows.map((r) => r.alertId!));
  const missing = rows.filter((r) => !have.has(r.alertId!));
  if (missing.length > 0) {
    await getDb().insert(schema.policyAlerts).values(missing);
  }
  return missing.length;
}

/** Recent policy documents (bills/regulations) for the radar scan. */
export async function recentPolicyDocuments(since: Date, jurisdictionId?: string) {
  const conds: SQL[] = [gte(schema.policyDocuments.createdAt, since)];
  if (jurisdictionId) {
    conds.push(eq(schema.policyDocuments.jurisdictionId, jurisdictionId));
  }
  return getDb()
    .select()
    .from(schema.policyDocuments)
    .where(and(...conds))
    .orderBy(desc(schema.policyDocuments.createdAt))
    .limit(500);
}

/** Recent budget lines for the radar scan (created within the window). */
export async function recentBudgets(since: Date, jurisdictionId?: string) {
  const conds: SQL[] = [gte(schema.budgets.createdAt, since)];
  if (jurisdictionId) {
    conds.push(eq(schema.budgets.jurisdictionId, jurisdictionId));
  }
  return getDb()
    .select()
    .from(schema.budgets)
    .where(and(...conds))
    .orderBy(desc(schema.budgets.createdAt))
    .limit(500);
}
