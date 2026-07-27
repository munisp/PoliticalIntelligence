import { and, asc, eq, gt } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";

export async function listJurisdictions(filters: {
  countryCode?: string;
  adminLevel?: schema.Jurisdiction["adminLevel"];
  cursor?: string;
  limit: number;
}) {
  const conds = [];
  if (filters.countryCode)
    conds.push(eq(schema.jurisdictions.countryCode, filters.countryCode));
  if (filters.adminLevel)
    conds.push(eq(schema.jurisdictions.adminLevel, filters.adminLevel));
  if (filters.cursor)
    conds.push(gt(schema.jurisdictions.jurisdictionId, filters.cursor));
  const rows = await getDb()
    .select()
    .from(schema.jurisdictions)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(schema.jurisdictions.jurisdictionId))
    .limit(filters.limit + 1);
  const items = rows.slice(0, filters.limit);
  return {
    items,
    next_cursor:
      rows.length > filters.limit
        ? items[items.length - 1].jurisdictionId
        : null,
  };
}

export async function findJurisdiction(jurisdictionId: string) {
  return getDb().query.jurisdictions.findFirst({
    where: eq(schema.jurisdictions.jurisdictionId, jurisdictionId),
  });
}

export async function latestMetricsForJurisdiction(
  jurisdictionId: string,
  opts?: { metricKeys?: string[]; periodFrom?: string; periodTo?: string },
) {
  const conds = [eq(schema.sectorMetrics.jurisdictionId, jurisdictionId)];
  if (opts?.periodFrom)
    conds.push(gt(schema.sectorMetrics.period, opts.periodFrom));
  const rows = await getDb()
    .select()
    .from(schema.sectorMetrics)
    .where(and(...conds))
    .orderBy(asc(schema.sectorMetrics.metricKey), asc(schema.sectorMetrics.period));
  if (opts?.periodTo)
    return rows.filter((r) => r.period <= opts.periodTo!);
  return rows;
}

export async function adminUnitTree(jurisdictionId: string) {
  const units = await getDb()
    .select()
    .from(schema.adminUnits)
    .where(eq(schema.adminUnits.jurisdictionId, jurisdictionId))
    .orderBy(asc(schema.adminUnits.name));
  const byParent = new Map<string | null, schema.AdminUnit[]>();
  for (const u of units) {
    const key = u.parentId ?? null;
    const arr = byParent.get(key) ?? [];
    arr.push(u);
    byParent.set(key, arr);
  }
  type Node = schema.AdminUnit & { children: Node[] };
  const build = (parent: string | null): Node[] =>
    (byParent.get(parent) ?? []).map((u) => ({
      ...u,
      children: build(u.adminUnitId),
    }));
  // Roots are units whose parent is null or outside this jurisdiction's set.
  const ids = new Set(units.map((u) => u.adminUnitId));
  const roots = units
    .filter((u) => !u.parentId || !ids.has(u.parentId))
    .map((u) => u.adminUnitId);
  const rootSet = new Set(roots);
  return units
    .filter((u) => rootSet.has(u.adminUnitId))
    .map((u) => ({ ...u, children: build(u.adminUnitId) }));
}
