import { asc, eq, inArray } from "drizzle-orm";
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
