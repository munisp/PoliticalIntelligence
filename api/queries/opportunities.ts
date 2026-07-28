import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";

export async function listSectors() {
  return getDb().select().from(schema.sectors).orderBy(asc(schema.sectors.name));
}

export async function sectorMetricsRange(filters: {
  jurisdictionId: string;
  sectorCode?: string;
  periodFrom?: string;
  periodTo?: string;
}) {
  const conds = [
    eq(schema.sectorMetrics.jurisdictionId, filters.jurisdictionId),
  ];
  if (filters.sectorCode)
    conds.push(eq(schema.sectorMetrics.sectorCode, filters.sectorCode));
  if (filters.periodFrom)
    conds.push(gte(schema.sectorMetrics.period, filters.periodFrom));
  if (filters.periodTo)
    conds.push(lte(schema.sectorMetrics.period, filters.periodTo));
  return getDb()
    .select()
    .from(schema.sectorMetrics)
    .where(and(...conds))
    .orderBy(
      asc(schema.sectorMetrics.sectorCode),
      asc(schema.sectorMetrics.metricKey),
      asc(schema.sectorMetrics.period),
    );
}

export async function opportunityRankings(filters: {
  jurisdictionId?: string;
  /** ABAC read scope: restrict to these jurisdiction ids. */
  jurisdictionIds?: string[];
  sectorCode?: string;
  horizonMaxMonths?: number;
  confidenceFloor?: number;
  cursor?: string;
  limit: number;
}) {
  const conds = [];
  if (filters.jurisdictionId)
    conds.push(eq(schema.opportunities.jurisdictionId, filters.jurisdictionId));
  if (filters.jurisdictionIds)
    conds.push(
      filters.jurisdictionIds.length > 0
        ? inArray(schema.opportunities.jurisdictionId, filters.jurisdictionIds)
        : eq(schema.opportunities.jurisdictionId, "__none__"),
    );
  if (filters.sectorCode)
    conds.push(eq(schema.opportunities.sectorCode, filters.sectorCode));
  if (filters.horizonMaxMonths)
    conds.push(lte(schema.opportunities.horizonMonths, filters.horizonMaxMonths));
  if (filters.confidenceFloor !== undefined)
    conds.push(gte(schema.opportunities.confidence, filters.confidenceFloor));
  // Offset-based cursor (opaque to clients); stable under score-desc ordering.
  const offset = filters.cursor ? Math.max(0, Number(filters.cursor) || 0) : 0;
  const rows = await getDb()
    .select()
    .from(schema.opportunities)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.opportunities.score), asc(schema.opportunities.opportunityId))
    .limit(filters.limit + 1)
    .offset(offset);
  const items = rows.slice(0, filters.limit);
  return {
    items,
    next_cursor:
      rows.length > filters.limit ? String(offset + filters.limit) : null,
  };
}

export async function findOpportunity(opportunityId: string) {
  return getDb().query.opportunities.findFirst({
    where: eq(schema.opportunities.opportunityId, opportunityId),
  });
}

export async function findOpportunitiesByIds(ids: string[]) {
  if (ids.length === 0) return [];
  return getDb()
    .select()
    .from(schema.opportunities)
    .where(inArray(schema.opportunities.opportunityId, ids));
}

export async function evidenceByIds(ids: string[]) {
  if (ids.length === 0) return [];
  return getDb()
    .select()
    .from(schema.evidenceSources)
    .where(inArray(schema.evidenceSources.evidenceSourceId, ids));
}

export async function findEvidence(evidenceSourceId: string) {
  return getDb().query.evidenceSources.findFirst({
    where: eq(schema.evidenceSources.evidenceSourceId, evidenceSourceId),
  });
}

export async function interventionsForOpportunity(opportunityId: string) {
  return getDb()
    .select()
    .from(schema.interventions)
    .where(eq(schema.interventions.opportunityId, opportunityId));
}

export async function insertRecommendation(
  row: typeof schema.recommendations.$inferInsert,
) {
  await getDb().insert(schema.recommendations).values(row);
}

export async function findRecommendation(recommendationId: string) {
  return getDb().query.recommendations.findFirst({
    where: eq(schema.recommendations.recommendationId, recommendationId),
  });
}
