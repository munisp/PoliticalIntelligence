import { describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import { insertBrief, findBrief } from "../queries/briefs";
import { insertJob } from "../queries/admin";
import { jobRunner, enqueuePersistedJob } from "../runner";

/**
 * Brief citations fix: the generation job must populate citations_rail from
 * the DB evidence bundle — never a permanently-empty rail.
 */
describe("brief generation citations", () => {
  it("generates a brief with at least 3 citations", async () => {
    const briefId = `brf:ng-kd:test-${nanoid(6)}`;
    await insertBrief({
      briefId,
      jurisdictionId: "jur:ng-kd",
      template: "executive_memo",
      title: "Citations test brief",
      reviewState: "draft",
      content: null,
      modelRouting: null,
      requestId: "req_test_brief_citations",
      createdBy: null,
    });
    const jobId = `job:${nanoid(16)}`;
    await insertJob({
      jobId,
      type: "briefs.generate",
      status: "queued",
      progress: 0,
      input: { brief_id: briefId, actor_id: null, opportunity_ids: [] },
      idempotencyKey: `test-brief-${nanoid(10)}`,
      actorId: null,
    });
    await enqueuePersistedJob(jobId);
    await jobRunner.drain();

    const brief = await findBrief(briefId);
    expect(brief).toBeTruthy();
    const content = brief!.content as {
      citations_rail: { evidence_source_id: string; citation: string }[];
    };
    expect(Array.isArray(content.citations_rail)).toBe(true);
    expect(content.citations_rail.length).toBeGreaterThanOrEqual(3);
    for (const c of content.citations_rail) {
      expect(c.evidence_source_id).toMatch(/^ev:/);
      expect(c.citation.length).toBeGreaterThan(0);
    }
    expect(brief!.reviewState).toBe("in_review");
  }, 30_000);
});
