import { desc, eq, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";

export async function insertPublished(row: {
  publishedId: string;
  scenarioRunId: string;
  publishedBy: number | null;
  title: string;
  summary: string | null;
  reproducibilityHash: string | null;
}) {
  await getDb().insert(schema.publishedScenarios).values({
    publishedId: row.publishedId,
    scenarioRunId: row.scenarioRunId,
    publishedBy: row.publishedBy,
    title: row.title,
    summary: row.summary,
    forkCount: 0,
    reproducibilityHash: row.reproducibilityHash,
  });
  return findPublished(row.publishedId);
}

export async function findPublished(publishedId: string) {
  return getDb().query.publishedScenarios.findFirst({
    where: eq(schema.publishedScenarios.publishedId, publishedId),
  });
}

export async function listPublished(limit = 25) {
  return getDb()
    .select()
    .from(schema.publishedScenarios)
    .orderBy(desc(schema.publishedScenarios.publishedAt))
    .limit(Math.min(limit, 100));
}

export async function incrementForkCount(publishedId: string) {
  await getDb()
    .update(schema.publishedScenarios)
    .set({ forkCount: sql`${schema.publishedScenarios.forkCount} + 1` })
    .where(eq(schema.publishedScenarios.publishedId, publishedId));
}
