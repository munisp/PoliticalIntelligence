import { and, asc, eq, inArray } from "drizzle-orm";
import * as schema from "@db/schema";
import type { CitationRelation, ReviewState } from "@contracts/entities";
import { getDb } from "./connection";

export async function listLaws(filters: {
  jurisdictionId?: string;
  /** ABAC read scope: restrict to these jurisdiction ids. */
  jurisdictionIds?: string[];
  category?: string;
  cursor?: string;
  limit: number;
}) {
  const conds = [];
  if (filters.jurisdictionId)
    conds.push(eq(schema.laws.jurisdictionId, filters.jurisdictionId));
  if (filters.jurisdictionIds)
    conds.push(
      filters.jurisdictionIds.length > 0
        ? inArray(schema.laws.jurisdictionId, filters.jurisdictionIds)
        : eq(schema.laws.jurisdictionId, "__none__"),
    );
  if (filters.category) conds.push(eq(schema.laws.category, filters.category));
  const offset = filters.cursor ? Math.max(0, Number(filters.cursor) || 0) : 0;
  const rows = await getDb()
    .select()
    .from(schema.laws)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(schema.laws.lawId))
    .limit(filters.limit + 1)
    .offset(offset);
  const items = rows.slice(0, filters.limit);
  return {
    items,
    next_cursor:
      rows.length > filters.limit ? String(offset + filters.limit) : null,
  };
}

export async function findLaw(lawId: string) {
  return getDb().query.laws.findFirst({
    where: eq(schema.laws.lawId, lawId),
  });
}

export async function clausesForLaw(lawId: string) {
  return getDb()
    .select()
    .from(schema.clauses)
    .where(eq(schema.clauses.lawId, lawId))
    .orderBy(asc(schema.clauses.sectionPath));
}

export async function findClause(clauseId: string) {
  return getDb().query.clauses.findFirst({
    where: eq(schema.clauses.clauseId, clauseId),
  });
}

export async function citationEdges(clauseIds: string[]) {
  if (clauseIds.length === 0) return [];
  return getDb()
    .select()
    .from(schema.citations)
    .where(inArray(schema.citations.fromClauseId, clauseIds));
}

export async function citationTrace(clauseId: string) {
  const [outbound, inbound] = await Promise.all([
    getDb()
      .select()
      .from(schema.citations)
      .where(eq(schema.citations.fromClauseId, clauseId)),
    getDb()
      .select()
      .from(schema.citations)
      .where(eq(schema.citations.toClauseId, clauseId)),
  ]);
  return { outbound, inbound };
}

/**
 * Breadth-first dependency paths over the citations graph from a seed clause
 * (or all clauses of a seed law), up to `depth` hops.
 */
export async function graphQuery(opts: {
  seedClauseId?: string;
  seedLawId?: string;
  relation?: CitationRelation;
  depth: number;
}) {
  let seeds: string[] = [];
  if (opts.seedClauseId) seeds = [opts.seedClauseId];
  else if (opts.seedLawId) {
    const cls = await clausesForLaw(opts.seedLawId);
    seeds = cls.map((c) => c.clauseId);
  }
  if (seeds.length === 0) return { nodes: [] as schema.Clause[], paths: [] as { from: string; to: string; relation: string }[][] };

  const visited = new Set(seeds);
  const paths: { from: string; to: string; relation: string }[][] = [];
  let frontier: { id: string; path: { from: string; to: string; relation: string }[] }[] =
    seeds.map((id) => ({ id, path: [] }));

  for (let d = 0; d < opts.depth && frontier.length > 0; d++) {
    const edges = await citationEdges(frontier.map((f) => f.id));
    const next: typeof frontier = [];
    for (const f of frontier) {
      for (const e of edges.filter(
        (e) =>
          e.fromClauseId === f.id &&
          (!opts.relation || e.relation === opts.relation),
      )) {
        const step = { from: e.fromClauseId, to: e.toClauseId, relation: e.relation };
        const path = [...f.path, step];
        paths.push(path);
        if (!visited.has(e.toClauseId)) {
          visited.add(e.toClauseId);
          next.push({ id: e.toClauseId, path });
        }
      }
    }
    frontier = next;
  }

  const nodes = await getDb()
    .select()
    .from(schema.clauses)
    .where(inArray(schema.clauses.clauseId, [...visited]));
  return { nodes, paths };
}

export async function clauseReviewQueue(filters: {
  reviewState?: ReviewState;
  lowConfidenceOnly?: boolean;
  limit: number;
}) {
  const conds = [];
  if (filters.reviewState)
    conds.push(eq(schema.clauses.reviewState, filters.reviewState));
  const rows = await getDb()
    .select()
    .from(schema.clauses)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(schema.clauses.confidence))
    .limit(filters.limit);
  return filters.lowConfidenceOnly ? rows.filter((r) => r.confidence < 0.75) : rows;
}

export async function updateClauseReviewState(
  clauseId: string,
  state: ReviewState,
) {
  await getDb()
    .update(schema.clauses)
    .set({ reviewState: state })
    .where(eq(schema.clauses.clauseId, clauseId));
}

export async function insertApprovalEvent(
  row: typeof schema.approvalEvents.$inferInsert,
) {
  await getDb().insert(schema.approvalEvents).values(row);
}

export async function approvalEventsFor(entityType: string, entityId: string) {
  return getDb()
    .select()
    .from(schema.approvalEvents)
    .where(
      and(
        eq(schema.approvalEvents.entityType, entityType),
        eq(schema.approvalEvents.entityId, entityId),
      ),
    )
    .orderBy(asc(schema.approvalEvents.createdAt));
}
