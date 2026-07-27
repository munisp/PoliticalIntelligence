import { describe, expect, it, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import { jobRunner, enqueuePersistedJob } from "../runner";
import { insertJob } from "../queries/admin";
import { nanoid } from "nanoid";
import type { TrpcContext } from "../context";
import type { User } from "@db/schema";

// Make the AI bridge fail fast (connection refused) so the deterministic
// fallbacks are exercised without a 5s timeout.
beforeAll(() => {
  process.env.AI_BASE_URL = "http://127.0.0.1:9";
  process.env.SIMULATION_BASE_URL = "http://127.0.0.1:9";
});

const anonCtx: TrpcContext = {
  req: new Request("http://test.local/"),
  resHeaders: new Headers(),
};

async function adminCtx(): Promise<TrpcContext> {
  const u = await getDb().query.users.findFirst({
    where: eq(schema.users.unionId, "demo-policy-analyst"),
  });
  if (!u) throw new Error("seed missing");
  const admin: User = { ...u, platformRole: "platform_admin" };
  return { ...anonCtx, user: admin };
}

describe("backend innovations", () => {
  it("1. trustScore composes weighted components with explanation", async () => {
    const caller = appRouter.createCaller(anonCtx);
    const res = await caller.innovations.trustScore({
      evidence_source_id: "ev:document:cama-2020-sme",
    });
    const d = res.data;
    expect(d.trust_score).toBeGreaterThan(0);
    expect(d.trust_score).toBeLessThanOrEqual(1);
    const w = d.weights;
    const expected =
      w.source_authority * d.components.source_authority +
      w.freshness * d.components.freshness +
      w.corroboration * d.components.corroboration +
      w.extraction_confidence * d.components.extraction_confidence;
    expect(d.trust_score).toBeCloseTo(expected, 3);
    expect(d.explanation.length).toBeGreaterThan(20);
  });

  it("2. scoreDecomposition waterfall sums to the stored score", async () => {
    const caller = appRouter.createCaller(anonCtx);
    const res = await caller.innovations.scoreDecomposition({
      opportunity_id: "opp:edu:digital-classroom-assistants",
    });
    const d = res.data;
    expect(d.contributions).toHaveLength(5);
    const sum = d.contributions.reduce((s, c) => s + c.contribution, 0);
    expect(sum).toBeCloseTo(d.stored_score, 4);
  });

  it("3. assumptionSensitivity ranks entries by swing", async () => {
    const caller = appRouter.createCaller(anonCtx);
    const res = await caller.innovations.assumptionSensitivity({ scenario_id: "scn:001" });
    const swings = res.data.entries.map((e) => e.swing);
    for (let i = 1; i < swings.length; i++) {
      expect(swings[i - 1]).toBeGreaterThanOrEqual(swings[i]);
    }
    expect(res.data.baseline_final_employment).toBeGreaterThan(0);
  });

  it("4. backtest job computes MAPE + skill score", async () => {
    const jobId = `job:${nanoid(16)}`;
    await insertJob({
      jobId,
      type: "innovations.backtest",
      status: "queued",
      progress: 0,
      input: { scenario_id: "scn:001", engine: "forecast", cutoff_month: 18 },
      idempotencyKey: null,
      actorId: null,
    });
    await enqueuePersistedJob(jobId);
    await jobRunner.drain();
    const caller = appRouter.createCaller(await adminCtx());
    const res = await caller.innovations.backtest.status({ job_id: jobId });
    expect(res.data.status).toBe("succeeded");
    const result = res.data.result!;
    expect(result.mape).toBeGreaterThanOrEqual(0);
    expect(result.skill_score).toBeGreaterThanOrEqual(0);
    expect(result.skill_score).toBeLessThanOrEqual(1);
    expect(result.series.length).toBeGreaterThan(0);
    expect(result.series[0].month).toBe(19);
  }, 30_000);

  it("5. multipliers.list returns seeded literature ranges with provenance", async () => {
    const caller = appRouter.createCaller(anonCtx);
    const res = await caller.innovations.multipliers.list();
    expect(res.data.length).toBeGreaterThanOrEqual(5);
    const edu = res.data.find((m) => m.sector_code === "edu")!;
    expect(edu.source).toContain("ILO");
    expect(edu.total).toBeCloseTo(edu.direct + edu.indirect + edu.induced, 6);
  });

  it("6. policyDiff aligns clauses across laws deterministically", async () => {
    const caller = appRouter.createCaller(anonCtx);
    const res = await caller.innovations.policyDiff({
      law_id_a: "law:ng:ppa-2007",
      law_id_b: "law:ng-kd:procurement-law",
    });
    const d = res.data;
    expect(d.aligned.length + d.unique_clauses.length).toBeGreaterThan(0);
    for (const a of d.aligned) {
      expect(a.similarity).toBeGreaterThanOrEqual(0.35);
    }
    const again = await caller.innovations.policyDiff({
      law_id_a: "law:ng:ppa-2007",
      law_id_b: "law:ng-kd:procurement-law",
    });
    expect(again.data).toEqual(d); // deterministic
  });

  it("7. procurementAnalysis returns HHI + data_origin flag", async () => {
    const caller = appRouter.createCaller(anonCtx);
    const res = await caller.innovations.procurementAnalysis({ jurisdiction_id: "jur:ng-kd" });
    const d = res.data;
    expect(d.data_origin).toBe("derived_from_opportunities");
    expect(d.supplier_concentration_hhi).toBeGreaterThanOrEqual(0);
    expect(d.supplier_concentration_hhi).toBeLessThanOrEqual(1);
    expect(d.local_share).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(d.flagged_patterns)).toBe(true);
  });

  it("8. recalibrate job persists twin states + drift report", async () => {
    const ctx = await adminCtx();
    const caller = appRouter.createCaller(ctx);
    const enq = await caller.innovations.recalibrate({ jurisdiction_id: "jur:ng-kd" });
    expect(enq.data.status).toBe("queued");
    await jobRunner.drain();
    const states = await getDb()
      .select()
      .from(schema.twinStates)
      .where(eq(schema.twinStates.jurisdictionId, "jur:ng-kd"));
    expect(states.length).toBeGreaterThan(0);
    expect(states[0].version).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("9. marketplace lists templates and install gates on approval", async () => {
    const ctx = await adminCtx();
    const caller = appRouter.createCaller(ctx);
    const list = await caller.innovations.marketplace.list({});
    expect(list.data.length).toBeGreaterThanOrEqual(3);
    // in_review template cannot be installed (human review required).
    await expect(
      caller.innovations.marketplace.install({
        template_id: "tpl:proc-local-content",
        jurisdiction_id: "jur:ng-kd",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // approved template installs and materializes a scenario.
    const installed = await caller.innovations.marketplace.install({
      template_id: "tpl:edu-teacher-pipeline",
      jurisdiction_id: "jur:ng-kd",
    });
    expect(installed.data.scenario_id).toMatch(/^scn:/);
  });

  it("10. optimizePortfolio respects budget and returns binding constraints", async () => {
    const interventions = await getDb()
      .select({ id: schema.interventions.interventionId })
      .from(schema.interventions);
    const ids = interventions.map((i) => i.id);
    const caller = appRouter.createCaller(await adminCtx());
    const res = await caller.innovations.optimizePortfolio({
      jurisdiction_id: "jur:ng-kd",
      budget_ngn: 20000,
      intervention_ids: ids,
    });
    const d = res.data;
    expect(d.cost_total_ngn_m).toBeLessThanOrEqual(20000);
    expect(d.selected.length).toBeGreaterThan(0);
    expect(d.expected_jobs_total).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(d.binding_constraints)).toBe(true);
  });

  it("11. parseScenarioText extracts sector/budget/horizon deterministically", async () => {
    const caller = appRouter.createCaller(anonCtx);
    const res = await caller.innovations.parseScenarioText({
      text: "Recruit 25,000 teachers for primary schools with a budget of ₦450 million over 3 years",
      jurisdiction_id: "jur:ng-kd",
    });
    const d = res.data;
    expect(d.sector_code.value).toBe("edu");
    expect(d.budget_ngn_m.value).toBe(450);
    expect(d.horizon_months.value).toBe(36);
    expect(d.intervention_hints.length).toBeGreaterThan(0);
    expect(d.overall_confidence).toBeGreaterThan(0.5);
  });

  it("12. webhooks create/list/test with signing secret", async () => {
    const caller = appRouter.createCaller(await adminCtx());
    const created = await caller.innovations.webhooks.create({
      url: "http://127.0.0.1:9/hook",
      topics: ["ops.alerts"],
    });
    expect(created.data.sub_id).toMatch(/^sub:/);
    expect(created.data.secret.length).toBeGreaterThanOrEqual(16);
    const list = await caller.innovations.webhooks.list({});
    expect(list.data.some((s) => s.sub_id === created.data.sub_id)).toBe(true);
    // test ping: endpoint is unreachable, delivery fails gracefully.
    const ping = await caller.innovations.webhooks.test({ sub_id: created.data.sub_id });
    expect(ping.data.ping).toBe(true);
    expect(ping.data.delivered).toBe(0);
  }, 30_000);

  it("12b. webhook signatures are HMAC-SHA256 verifiable", async () => {
    const { signWebhookPayload } = await import("../utils/events");
    const sig = signWebhookPayload("secret-0123456789abcdef", '{"a":1}');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signWebhookPayload("secret-0123456789abcdef", '{"a":1}')).toBe(sig);
    expect(signWebhookPayload("other-secret-0123456789", '{"a":1}')).not.toBe(sig);
  });

  it("audit chain verify procedure reports a valid chain", async () => {
    const caller = appRouter.createCaller(await adminCtx());
    const res = await caller.auditLog.verify();
    expect(res.data.chain_valid).toBe(true);
    expect(res.data.events_checked).toBeGreaterThan(0);
  });
});
