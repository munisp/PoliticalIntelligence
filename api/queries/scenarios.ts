import { and, asc, desc, eq, inArray } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";

export async function listScenarios(filters: {
  jurisdictionId?: string;
  status?: string;
  cursor?: string;
  limit: number;
}) {
  const conds = [];
  if (filters.jurisdictionId)
    conds.push(eq(schema.scenarios.jurisdictionId, filters.jurisdictionId));
  if (filters.status) conds.push(eq(schema.scenarios.status, filters.status));
  const offset = filters.cursor ? Math.max(0, Number(filters.cursor) || 0) : 0;
  const rows = await getDb()
    .select()
    .from(schema.scenarios)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.scenarios.createdAt), asc(schema.scenarios.scenarioId))
    .limit(filters.limit + 1)
    .offset(offset);
  const items = rows.slice(0, filters.limit);
  return {
    items,
    next_cursor:
      rows.length > filters.limit ? String(offset + filters.limit) : null,
  };
}

export async function findScenario(scenarioId: string) {
  return getDb().query.scenarios.findFirst({
    where: eq(schema.scenarios.scenarioId, scenarioId),
  });
}

export async function insertScenario(
  row: typeof schema.scenarios.$inferInsert,
) {
  await getDb().insert(schema.scenarios).values(row);
}

export async function listAssumptionSets() {
  return getDb()
    .select()
    .from(schema.assumptionSets)
    .orderBy(asc(schema.assumptionSets.assumptionsSetId));
}

export async function findAssumptionSet(assumptionsSetId: string) {
  return getDb().query.assumptionSets.findFirst({
    where: eq(schema.assumptionSets.assumptionsSetId, assumptionsSetId),
  });
}

export async function insertSimulationRun(
  row: typeof schema.simulationRuns.$inferInsert,
) {
  await getDb().insert(schema.simulationRuns).values(row);
}

export async function findSimulationRun(simulationRunId: string) {
  return getDb().query.simulationRuns.findFirst({
    where: eq(schema.simulationRuns.simulationRunId, simulationRunId),
  });
}

export async function runsForScenario(scenarioId: string) {
  return getDb()
    .select()
    .from(schema.simulationRuns)
    .where(eq(schema.simulationRuns.scenarioId, scenarioId))
    .orderBy(desc(schema.simulationRuns.createdAt));
}

export async function findSimulationRunsByIds(ids: string[]) {
  if (ids.length === 0) return [];
  return getDb()
    .select()
    .from(schema.simulationRuns)
    .where(inArray(schema.simulationRuns.simulationRunId, ids));
}

export async function updateSimulationRunResult(
  simulationRunId: string,
  patch: Partial<typeof schema.simulationRuns.$inferInsert>,
) {
  await getDb()
    .update(schema.simulationRuns)
    .set(patch)
    .where(eq(schema.simulationRuns.simulationRunId, simulationRunId));
}

/** Artifacts = succeeded runs with an artifact URI (MinIO/S3 handle in prod). */
export async function listArtifacts(scenarioId?: string) {
  const conds = [eq(schema.simulationRuns.status, "succeeded" as const)];
  if (scenarioId)
    conds.push(eq(schema.simulationRuns.scenarioId, scenarioId));
  const rows = await getDb()
    .select()
    .from(schema.simulationRuns)
    .where(and(...conds))
    .orderBy(desc(schema.simulationRuns.finishedAt));
  return rows.filter((r) => r.artifactUri);
}
