import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { SaxesParser } from "saxes";
import * as schema from "@db/schema";
import type { User } from "@db/schema";
import type { TrpcContext } from "../context";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import { insertJob } from "../queries/admin";
import { insertScenario, insertSimulationRun } from "../queries/scenarios";
import { jobRunner, enqueuePersistedJob } from "../runner";
import { DRAFT_SECTIONS, type ClauseSet, type RiaAnnex } from "@contracts/drafting";

/**
 * G4 — evidence-grounded drafting workflow tests.
 * Seeds a real scenario + simulation run (via the job runner, so manifest +
 * reproducibility hash are persisted), then exercises the full drafting path.
 */

async function demoUser(unionId: string): Promise<User> {
  const user = await getDb().query.users.findFirst({
    where: eq(schema.users.unionId, unionId),
  });
  if (!user) throw new Error(`seed user ${unionId} missing — run db/seed.ts`);
  return user;
}

function ctxFor(user: User): TrpcContext {
  return { req: new Request("http://test.local/"), resHeaders: new Headers(), user };
}

const ANON: TrpcContext = {
  req: new Request("http://test.local/"),
  resHeaders: new Headers(),
};

function parseXml(xml: string): { ok: boolean; tags: string[] } {
  const tags: string[] = [];
  let ok = true;
  const p = new SaxesParser();
  p.on("error", () => {
    ok = false;
  });
  p.on("opentag", (t) => tags.push((t as { name: string }).name));
  p.write(xml).close();
  return { ok, tags };
}

let legal: User;
let caller: ReturnType<typeof appRouter.createCaller>;
let simulationRunId: string;

beforeAll(async () => {
  legal = await demoUser("demo-legal-analyst");
  caller = appRouter.createCaller(ctxFor(legal));

  // Seed a scenario + run through the real simulations.run job so the run
  // carries result summary, manifest and reproducibility hash (DM-3).
  const scenarioId = `scn:ng-kd:g4-${nanoid(8)}`;
  await insertScenario({
    scenarioId,
    jurisdictionId: "jur:ng-kd",
    name: "G4 drafting test scenario",
    description: "Apprenticeship wage-subsidy scale-up for drafting tests.",
    status: "draft",
    modelPlan: [{ engine: "system_dynamics", params: {} }] as never,
    createdBy: null,
  });
  simulationRunId = `run:${nanoid(12)}`;
  await insertSimulationRun({
    simulationRunId,
    scenarioId,
    engine: "system_dynamics",
    status: "queued",
    progress: 0,
    seed: 42,
  });
  const jobId = `job:${nanoid(16)}`;
  await insertJob({
    jobId,
    type: "simulations.run",
    status: "queued",
    progress: 0,
    input: { simulation_run_id: simulationRunId, actor_id: null },
    idempotencyKey: `g4-run-${nanoid(10)}`,
    actorId: null,
  });
  await enqueuePersistedJob(jobId);
  await jobRunner.drain();
}, 60_000);

/** Remove G4 test rows so findFirst()-based tests elsewhere are unaffected. */
afterAll(async () => {
  const db = getDb();
  const { like } = await import("drizzle-orm");
  await db.delete(schema.clauses).where(like(schema.clauses.lawId, "law:ng-kd:draft:%"));
  await db.delete(schema.laws).where(like(schema.laws.lawId, "law:ng-kd:draft:%"));
  await db
    .delete(schema.simulationRuns)
    .where(like(schema.simulationRuns.scenarioId, "scn:ng-kd:g4-%"));
  await db
    .delete(schema.scenarios)
    .where(like(schema.scenarios.scenarioId, "scn:ng-kd:g4-%"));
});

describe("G4 drafting — auth & role gates", () => {
  it("anonymous callers are UNAUTHORIZED", async () => {
    const anon = appRouter.createCaller(ANON);
    await expect(
      anon.legislation.createDraft({
        jurisdictionId: "jur:ng-kd",
        title: "Anon Bill",
        purpose: "A purpose long enough to pass validation.",
        evidenceBase: {},
        targetOutcomes: [],
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("non-drafting roles are FORBIDDEN", async () => {
    const sim = await demoUser("demo-sim-specialist");
    const c = appRouter.createCaller(ctxFor(sim));
    await expect(
      c.legislation.createDraft({
        jurisdictionId: "jur:ng-kd",
        title: "Forbidden Bill",
        purpose: "A purpose long enough to pass validation.",
        evidenceBase: {},
        targetOutcomes: [],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("G4 drafting — end-to-end workflow", () => {
  let lawId: string;

  it("createDraft persists a draft law linked to its evidence base", async () => {
    const res = await caller.legislation.createDraft({
      jurisdictionId: "jur:ng-kd",
      title: "Kaduna Skills Acceleration Bill",
      purpose:
        "To establish enabling instruments for evidence-grounded skills interventions.",
      evidenceBase: { simulation_run_id: simulationRunId },
      targetOutcomes: ["Create 5,000 apprenticeship placements", "Raise completion rate"],
    });
    lawId = res.data.law_id;
    expect(lawId).toMatch(/^law:ng-kd:draft:/);
    const row = await getDb().query.laws.findFirst({
      where: eq(schema.laws.lawId, lawId),
    });
    expect(row?.status).toBe("draft");
    const eb = row?.evidenceBase as { simulation_run_id?: string };
    expect(eb.simulation_run_id).toBe(simulationRunId);
  });

  it("audit event recorded for draft creation", async () => {
    // audit() is fire-and-forget; allow the insert to land.
    await new Promise((r) => setTimeout(r, 500));
    const events = await getDb()
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "legislation.draft.created"));
    expect(events.some((e) => e.entityId === lawId)).toBe(true);
  });

  let firstClauses: ClauseSet["clauses"];

  it("generateClauses produces the five canonical sections with grounding", async () => {
    const res = await caller.legislation.generateClauses({ law_id: lawId });
    expect(res.data.bridge).toBe("fallback"); // offline deterministic tier
    firstClauses = res.data.clauses;
    expect(firstClauses.map((c) => c.section)).toEqual([...DRAFT_SECTIONS]);
    for (const clause of firstClauses) {
      expect(clause.grounding.length).toBeGreaterThanOrEqual(1);
      for (const g of clause.grounding) {
        expect(["simulation_run", "opportunity", "citation"]).toContain(g.kind);
        expect(g.note.length).toBeGreaterThan(0);
      }
    }
    // Simulation grounding must reference the seeded run somewhere.
    const simGrounded = firstClauses.some((c) =>
      c.grounding.some((g) => g.kind === "simulation_run" && g.id === simulationRunId),
    );
    expect(simGrounded).toBe(true);
    // Persisted to the clauses table.
    const persisted = await getDb()
      .select()
      .from(schema.clauses)
      .where(eq(schema.clauses.lawId, lawId));
    expect(persisted.length).toBe(5);
    expect(persisted.every((c) => c.grounding !== null)).toBe(true);
  });

  it("offline tier is deterministic — regeneration yields identical clauses", async () => {
    const res = await caller.legislation.generateClauses({ law_id: lawId });
    expect(res.data.clauses).toEqual(firstClauses);
  });

  it("updateDraftClause edits text and preserves grounding", async () => {
    const clauseId = `cls:${lawId}:gen:obligations`;
    const res = await caller.legislation.updateDraftClause({
      clause_id: clauseId,
      text: "(1) Edited obligation text for the drafting test.",
    });
    expect(res.data?.text).toContain("Edited obligation text");
    const row = await getDb().query.clauses.findFirst({
      where: eq(schema.clauses.clauseId, clauseId),
    });
    expect(row?.grounding).not.toBeNull();
  });

  let ria: RiaAnnex;

  it("attachRIA builds the annex from the seeded simulation run", async () => {
    const res = await caller.legislation.attachRIA({ law_id: lawId });
    ria = res.data;
    expect(ria.simulation_run_id).toBe(simulationRunId);
    expect(ria.engine).toBe("system_dynamics");
    expect(ria.consensus_summary.length).toBeGreaterThan(20);
    expect(ria.point_estimates.length).toBeGreaterThanOrEqual(1);
    const pe = ria.point_estimates[0];
    expect(pe.lower).toBeLessThanOrEqual(pe.value);
    expect(pe.upper).toBeGreaterThanOrEqual(pe.value);
    expect(pe.horizon_months).toBeGreaterThan(0);
    expect(ria.assumptions.length).toBeGreaterThanOrEqual(1);
    const run = await getDb().query.simulationRuns.findFirst({
      where: eq(schema.simulationRuns.simulationRunId, simulationRunId),
    });
    expect(ria.reproducibility_hash).toBe(run?.reproducibilityHash);
    // Persisted on the law row.
    const law = await getDb().query.laws.findFirst({
      where: eq(schema.laws.lawId, lawId),
    });
    expect((law?.riaAnnex as RiaAnnex | null)?.simulation_run_id).toBe(simulationRunId);
  });

  it("exportDraftAkn emits well-formed AKN 3.0 with the RIA annex", async () => {
    const res = await caller.legislation.exportDraftAkn({ law_id: lawId, year: 2026 });
    const xml = res.data.akn_xml;
    const { ok, tags } = parseXml(xml);
    expect(ok).toBe(true);
    expect(tags).toContain("akomaNtoso");
    expect(tags).toContain("act");
    expect(tags).toContain("body");
    expect(tags).toContain("annex");
    expect(xml).toContain("FRBRWork");
    expect(xml).toContain("/akn/ng/bill/2026/");
    expect(xml).toContain("Regulatory Impact Assessment");
    expect(xml).toContain(ria.reproducibility_hash);
    expect(res.data.problems).toEqual([]);
  });
});
