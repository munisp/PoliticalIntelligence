import { beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import { anonCtx, ctxFor, ensureUser } from "./helpers";
import type { User } from "@db/schema";

let runId: string;
let scenarioJurisdiction: string;
let sim: User;
let analyst: User;

beforeAll(async () => {
  const db = getDb();
  const runs = (await db.query.simulationRuns.findMany({ limit: 20 })).filter(
    (r) => r.manifest && r.reproducibilityHash,
  );
  if (!runs.length) throw new Error("no reproducible runs seeded");
  runId = runs[0].simulationRunId;
  const scenario = await db.query.scenarios.findFirst();
  if (!scenario) throw new Error("no scenarios seeded");
  scenarioJurisdiction = scenario.jurisdictionId;
  sim = await ensureUser("demo-sim-specialist", "simulation_specialist");
  analyst = await ensureUser("demo-policy-analyst", "policy_analyst");
});

describe("marketplace router", () => {
  let publishedId: string;

  it("publish requires a reproducible run and is role-gated", async () => {
    const legal = await ensureUser("demo-legal-analyst", "legal_analyst");
    await expect(
      appRouter.createCaller(ctxFor(legal)).marketplace.publish({
        simulation_run_id: runId,
        title: "Should fail",
      }),
    ).rejects.toThrow();
    await expect(
      appRouter.createCaller(ctxFor(sim)).marketplace.publish({
        simulation_run_id: "sim:nope",
        title: "Missing run",
      }),
    ).rejects.toThrow();
  });

  it("publish → list exposes the entry with hash snapshot", async () => {
    const res = await appRouter.createCaller(ctxFor(sim)).marketplace.publish({
      simulation_run_id: runId,
      title: "Kaduna employment push — peer baseline",
      summary: "Forecast-engine baseline other states can fork.",
    });
    publishedId = res.data!.publishedId;
    expect(res.data!.reproducibilityHash).toBeTruthy();
    const list = await appRouter.createCaller(anonCtx()).marketplace.list({});
    const found = list.data.find((p) => p.published_id === publishedId);
    expect(found).toBeTruthy();
    expect(found!.fork_count).toBe(0);
  });

  it("verify recomputes the hash → valid badge", async () => {
    const v = await appRouter
      .createCaller(anonCtx())
      .marketplace.verify({ published_id: publishedId });
    expect(v.data.badge).toBe("valid");
    expect(v.data.recomputed_hash).toBe(v.data.run_hash);
  });

  it("fork creates a draft scenario from the published assumptions and increments forkCount", async () => {
    const res = await appRouter.createCaller(ctxFor(analyst)).marketplace.fork({
      published_id: publishedId,
      jurisdiction_id: scenarioJurisdiction,
    });
    expect(res.data.scenario_id).toMatch(/^scn:/);
    const scn = await getDb().query.scenarios.findFirst({
      where: (t, { eq }) => eq(t.scenarioId, res.data.scenario_id),
    });
    expect(scn?.status).toBe("draft");
    expect(scn?.description).toContain(publishedId);
    const list = await appRouter.createCaller(anonCtx()).marketplace.list({});
    expect(
      list.data.find((p) => p.published_id === publishedId)?.fork_count,
    ).toBe(1);
  });
});
