import { and, asc, desc, eq, inArray } from "drizzle-orm";
import * as schema from "@db/schema";
import type { SourceHealth } from "@contracts/entities";
import { getDb } from "./connection";

export async function listDataSources(filters: {
  health?: SourceHealth;
  category?: string;
}) {
  const conds = [];
  if (filters.health) conds.push(eq(schema.dataSources.health, filters.health));
  if (filters.category)
    conds.push(eq(schema.dataSources.category, filters.category));
  return getDb()
    .select()
    .from(schema.dataSources)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(schema.dataSources.sourceId));
}

export async function dataSourcesByIds(ids: string[]) {
  if (ids.length === 0) return [];
  return getDb()
    .select()
    .from(schema.dataSources)
    .where(inArray(schema.dataSources.sourceId, ids));
}

export async function findDataSource(sourceId: string) {
  return getDb().query.dataSources.findFirst({
    where: eq(schema.dataSources.sourceId, sourceId),
  });
}

export async function updateDataSource(
  sourceId: string,
  patch: Partial<typeof schema.dataSources.$inferInsert>,
) {
  await getDb()
    .update(schema.dataSources)
    .set(patch)
    .where(eq(schema.dataSources.sourceId, sourceId));
}

export async function listPipelineRuns(filters: {
  sourceId?: string;
  status?: schema.PipelineRun["status"];
  limit: number;
}) {
  const conds = [];
  if (filters.sourceId)
    conds.push(eq(schema.pipelineRuns.sourceId, filters.sourceId));
  if (filters.status) conds.push(eq(schema.pipelineRuns.status, filters.status));
  return getDb()
    .select()
    .from(schema.pipelineRuns)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.pipelineRuns.createdAt))
    .limit(filters.limit);
}

/** Topbar freshness chip: worst health + most recent refresh across sources. */
export async function freshnessSummary() {
  const rows = await getDb().select().from(schema.dataSources);
  if (rows.length === 0) {
    return { asOf: null as Date | null, status: "stale" as const, sources: 0 };
  }
  const status = rows.some((r) => r.health === "failing")
    ? ("failing" as const)
    : rows.some((r) => r.health === "stale")
      ? ("stale" as const)
      : ("healthy" as const);
  const asOf = rows
    .map((r) => r.lastRefresh)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  return { asOf, status, sources: rows.length };
}
