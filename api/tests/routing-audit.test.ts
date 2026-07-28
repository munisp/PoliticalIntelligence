import { and, desc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { insertBrief } from "../queries/briefs";
import { insertJob } from "../queries/admin";
import { jobRunner, enqueuePersistedJob } from "../runner";

/**
 * AI-8: every generation (brief or recommendation) persists its model
 * routing record to the immutable, hash-chained audit store.
 */
async function latestAuditPayload(action: string, entityId: string) {
  const rows = await getDb()
    .select()
    .from(schema.auditEvents)
    .where(
      and(
        eq(schema.auditEvents.action, action),
        eq(schema.auditEvents.entityId, entityId),
      ),
    )
    .orderBy(desc(schema.auditEvents.eventId))
    .limit(1);
  return rows[0]?.payload as Record<string, unknown> | null;
}

describe("model routing audit records (AI-8)", () => {
  it("briefs.generate persists model_routing to the audit store", async () => {
    const briefId = `brf:ng-kd:routing-${nanoid(6)}`;
    await insertBrief({
      briefId,
      jurisdictionId: "jur:ng-kd",
      template: "executive_memo",
      title: "Routing audit brief",
      reviewState: "draft",
      content: null,
      modelRouting: null,
      requestId: `req_${nanoid(8)}`,
      createdBy: null,
    });
    const jobId = `job:${nanoid(16)}`;
    await insertJob({
      jobId,
      type: "briefs.generate",
      status: "queued",
      progress: 0,
      input: { brief_id: briefId, actor_id: null, opportunity_ids: [] },
      idempotencyKey: `test-routing-${nanoid(10)}`,
      actorId: null,
    });
    await enqueuePersistedJob(jobId);
    await jobRunner.drain();

    const payload = await latestAuditPayload("reports.generated", briefId);
    expect(payload).toBeTruthy();
    const routing = (payload!.data as Record<string, unknown>).model_routing as Record<string, unknown>;
    expect(routing).toBeTruthy();
    expect(routing.tier).toBe("offline-fallback");
    expect(typeof routing.model).toBe("string");
    expect(routing.fallback).toBe(true);
    expect(typeof routing.decided_at).toBe("string");
  }, 30_000);

  it("opportunities.generate persists model_routing to the audit store", async () => {
    // Any seeded opportunity works; the generation falls back offline.
    const opps = await getDb()
      .select({ id: schema.opportunities.opportunityId })
      .from(schema.opportunities)
      .limit(1);
    expect(opps.length).toBeGreaterThan(0);
    // The deterministic fallback generator derives the recommendation id
    // from the opportunity — clear any prior rows so the insert succeeds.
    await getDb()
      .delete(schema.recommendations)
      .where(eq(schema.recommendations.opportunityId, opps[0].id));
    const jobId = `job:${nanoid(16)}`;
    await insertJob({
      jobId,
      type: "opportunities.generate",
      status: "queued",
      progress: 0,
      input: { opportunity_id: opps[0].id, actor_id: null },
      idempotencyKey: `test-routing-${nanoid(10)}`,
      actorId: null,
    });
    await enqueuePersistedJob(jobId);
    await jobRunner.drain();

    const rows = await getDb()
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "recommendations.generated"))
      .orderBy(desc(schema.auditEvents.eventId))
      .limit(1);
    expect(rows.length).toBe(1);
    const payload = rows[0].payload as Record<string, unknown>;
    const routing = (payload.data as Record<string, unknown>).model_routing as Record<string, unknown>;
    expect(routing).toBeTruthy();
    expect(["remote", "offline-fallback"]).toContain(routing.tier);
    expect(typeof routing.model).toBe("string");
    expect(typeof routing.fallback).toBe("boolean");
    expect(typeof routing.decided_at).toBe("string");
  }, 30_000);
});
