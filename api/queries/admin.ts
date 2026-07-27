import { and, asc, desc, eq, like, or } from "drizzle-orm";
import * as schema from "@db/schema";
import type { JobStatus, ReviewState } from "@contracts/entities";
import { getDb } from "./connection";

/* ------------------------------- jobs ------------------------------- */

export async function insertJob(row: typeof schema.jobs.$inferInsert) {
  await getDb().insert(schema.jobs).values(row);
}

export async function findJobByIdempotencyKey(key: string) {
  return getDb().query.jobs.findFirst({
    where: eq(schema.jobs.idempotencyKey, key),
  });
}

export async function findJob(jobId: string) {
  return getDb().query.jobs.findFirst({
    where: eq(schema.jobs.jobId, jobId),
  });
}

export async function listJobsForActor(actorId: number, limit: number) {
  return getDb()
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.actorId, actorId))
    .orderBy(desc(schema.jobs.createdAt))
    .limit(limit);
}

export async function updateJob(
  jobId: string,
  patch: Partial<typeof schema.jobs.$inferInsert>,
) {
  await getDb()
    .update(schema.jobs)
    .set(patch)
    .where(eq(schema.jobs.jobId, jobId));
}

/** DB-backed JobStore for api/utils/jobs.ts. */
export const dbJobStore = {
  async setRunning(jobId: string) {
    await updateJob(jobId, { status: "running" as JobStatus });
  },
  async setProgress(jobId: string, progress: number) {
    await updateJob(jobId, { progress });
  },
  async setSucceeded(jobId: string, result: unknown) {
    await updateJob(jobId, {
      status: "succeeded" as JobStatus,
      progress: 100,
      result: result as never,
      finishedAt: new Date(),
    });
  },
  async setFailed(jobId: string, error: string) {
    await updateJob(jobId, {
      status: "failed" as JobStatus,
      error,
      finishedAt: new Date(),
    });
  },
};

/* ---------------------------- review tasks --------------------------- */

export async function listReviewTasks(filters: {
  type?: schema.ReviewTask["type"];
  status?: string;
  assigneeRole?: string;
  limit: number;
}) {
  const conds = [];
  if (filters.type) conds.push(eq(schema.reviewTasks.type, filters.type));
  if (filters.status) conds.push(eq(schema.reviewTasks.status, filters.status));
  if (filters.assigneeRole)
    conds.push(eq(schema.reviewTasks.assigneeRole, filters.assigneeRole));
  return getDb()
    .select()
    .from(schema.reviewTasks)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.reviewTasks.createdAt))
    .limit(filters.limit);
}

export async function findReviewTask(taskId: string) {
  return getDb().query.reviewTasks.findFirst({
    where: eq(schema.reviewTasks.taskId, taskId),
  });
}

export async function updateReviewTask(
  taskId: string,
  patch: Partial<typeof schema.reviewTasks.$inferInsert>,
) {
  await getDb()
    .update(schema.reviewTasks)
    .set(patch)
    .where(eq(schema.reviewTasks.taskId, taskId));
}

/* ---------------------------- documents ------------------------------ */

export async function listDocuments(filters: {
  jurisdictionId?: string;
  reviewState?: ReviewState;
  language?: string;
  confidenceBelow?: number;
  cursor?: string;
  limit: number;
}) {
  const conds = [];
  if (filters.jurisdictionId)
    conds.push(eq(schema.policyDocuments.jurisdictionId, filters.jurisdictionId));
  if (filters.reviewState)
    conds.push(eq(schema.policyDocuments.reviewState, filters.reviewState));
  if (filters.language)
    conds.push(eq(schema.policyDocuments.language, filters.language));
  const offset = filters.cursor ? Math.max(0, Number(filters.cursor) || 0) : 0;
  const rows = await getDb()
    .select()
    .from(schema.policyDocuments)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.policyDocuments.createdAt), asc(schema.policyDocuments.documentId))
    .limit(filters.limit + 1)
    .offset(offset);
  let items = rows.slice(0, filters.limit);
  if (filters.confidenceBelow !== undefined) {
    items = items.filter(
      (d) => d.ocrConfidence !== null && d.ocrConfidence < filters.confidenceBelow!,
    );
  }
  return {
    items,
    next_cursor:
      rows.length > filters.limit ? String(offset + filters.limit) : null,
  };
}

export async function findDocument(documentId: string) {
  return getDb().query.policyDocuments.findFirst({
    where: eq(schema.policyDocuments.documentId, documentId),
  });
}

export async function insertDocument(
  row: typeof schema.policyDocuments.$inferInsert,
) {
  await getDb().insert(schema.policyDocuments).values(row);
}

/* ------------------------------- search ------------------------------ */

/**
 * SQL fallback search (LIKE + naive scoring). The hybrid retrieval service
 * (services/ai: vector + graph adapters) replaces this when AI_BASE_URL is
 * reachable — see api/bridges/ai.ts.
 */
export async function searchLike(opts: {
  q: string;
  jurisdictionId?: string;
  limit: number;
}) {
  const pattern = `%${opts.q}%`;
  const per = Math.max(1, Math.floor(opts.limit / 4));
  const jur = opts.jurisdictionId;

  const [opps, lawRows, clauseRows, briefRows] = await Promise.all([
    getDb()
      .select()
      .from(schema.opportunities)
      .where(
        and(
          or(
            like(schema.opportunities.title, pattern),
            like(schema.opportunities.summary, pattern),
          ),
          jur ? eq(schema.opportunities.jurisdictionId, jur) : undefined,
        ),
      )
      .limit(per),
    getDb()
      .select()
      .from(schema.laws)
      .where(
        and(
          like(schema.laws.title, pattern),
          jur ? eq(schema.laws.jurisdictionId, jur) : undefined,
        ),
      )
      .limit(per),
    getDb()
      .select()
      .from(schema.clauses)
      .where(like(schema.clauses.text, pattern))
      .limit(per),
    getDb()
      .select()
      .from(schema.briefs)
      .where(
        and(
          like(schema.briefs.title, pattern),
          jur ? eq(schema.briefs.jurisdictionId, jur) : undefined,
        ),
      )
      .limit(per),
  ]);
  return { opportunities: opps, laws: lawRows, clauses: clauseRows, briefs: briefRows };
}
