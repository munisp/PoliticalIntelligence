import { and, asc, desc, eq, inArray } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";

export async function listPathways() {
  return getDb()
    .select()
    .from(schema.regulatoryPathways)
    .orderBy(asc(schema.regulatoryPathways.pathwayId));
}

export async function findPathway(pathwayId: string) {
  return getDb().query.regulatoryPathways.findFirst({
    where: eq(schema.regulatoryPathways.pathwayId, pathwayId),
  });
}

export async function allStakeholders() {
  return getDb().select().from(schema.stakeholders);
}

export async function stakeholdersByIds(ids: string[]) {
  if (ids.length === 0) return [];
  return getDb()
    .select()
    .from(schema.stakeholders)
    .where(inArray(schema.stakeholders.stakeholderId, ids));
}

export async function allEdges() {
  return getDb().select().from(schema.stakeholderEdges);
}

export async function edgesTouching(ids: string[]) {
  if (ids.length === 0) return [];
  return getDb()
    .select()
    .from(schema.stakeholderEdges)
    .where(inArray(schema.stakeholderEdges.fromId, ids));
}

export async function edgesTargeting(ids: string[]) {
  if (ids.length === 0) return [];
  return getDb()
    .select()
    .from(schema.stakeholderEdges)
    .where(inArray(schema.stakeholderEdges.toId, ids));
}

/** Keyword search over the laws table (title/category) for analyzeIdea. */
export async function allLawsLite() {
  return getDb()
    .select({
      lawId: schema.laws.lawId,
      title: schema.laws.title,
      category: schema.laws.category,
      jurisdictionId: schema.laws.jurisdictionId,
    })
    .from(schema.laws);
}

/* --------------------------- I5 — engagements ------------------------ */

export async function insertEngagement(row: schema.InsertStakeholderEngagement) {
  await getDb().insert(schema.stakeholderEngagements).values(row);
  const [created] = await getDb()
    .select()
    .from(schema.stakeholderEngagements)
    .where(
      and(
        eq(schema.stakeholderEngagements.stakeholderId, row.stakeholderId),
        eq(schema.stakeholderEngagements.userId, row.userId),
      ),
    )
    .orderBy(desc(schema.stakeholderEngagements.id))
    .limit(1);
  return created;
}

/** Own-user scoped engagement history for one stakeholder. */
export async function engagementsFor(
  stakeholderId: string,
  userId: number,
  limit: number,
) {
  return getDb()
    .select()
    .from(schema.stakeholderEngagements)
    .where(
      and(
        eq(schema.stakeholderEngagements.stakeholderId, stakeholderId),
        eq(schema.stakeholderEngagements.userId, userId),
      ),
    )
    .orderBy(desc(schema.stakeholderEngagements.engagedAt))
    .limit(limit);
}

/** Own-user engagements that carry a next action (for the actions list). */
export async function upcomingEngagementsFor(userId: number, limit = 50) {
  return getDb()
    .select()
    .from(schema.stakeholderEngagements)
    .where(eq(schema.stakeholderEngagements.userId, userId))
    .orderBy(asc(schema.stakeholderEngagements.nextActionDate))
    .limit(limit);
}
