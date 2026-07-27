import { and, desc, eq, asc } from "drizzle-orm";
import * as schema from "@db/schema";
import type { ReviewState } from "@contracts/entities";
import { getDb } from "./connection";

export async function listBriefs(filters: {
  jurisdictionId?: string;
  reviewState?: ReviewState;
  cursor?: string;
  limit: number;
}) {
  const conds = [];
  if (filters.jurisdictionId)
    conds.push(eq(schema.briefs.jurisdictionId, filters.jurisdictionId));
  if (filters.reviewState)
    conds.push(eq(schema.briefs.reviewState, filters.reviewState));
  const offset = filters.cursor ? Math.max(0, Number(filters.cursor) || 0) : 0;
  const rows = await getDb()
    .select()
    .from(schema.briefs)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.briefs.createdAt), asc(schema.briefs.briefId))
    .limit(filters.limit + 1)
    .offset(offset);
  const items = rows.slice(0, filters.limit);
  return {
    items,
    next_cursor:
      rows.length > filters.limit ? String(offset + filters.limit) : null,
  };
}

export async function findBrief(briefId: string) {
  return getDb().query.briefs.findFirst({
    where: eq(schema.briefs.briefId, briefId),
  });
}

export async function insertBrief(row: typeof schema.briefs.$inferInsert) {
  await getDb().insert(schema.briefs).values(row);
}

export async function updateBrief(
  briefId: string,
  patch: Partial<typeof schema.briefs.$inferInsert>,
) {
  await getDb()
    .update(schema.briefs)
    .set(patch)
    .where(eq(schema.briefs.briefId, briefId));
}
