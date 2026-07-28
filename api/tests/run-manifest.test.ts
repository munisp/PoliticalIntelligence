import { describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import {
  insertScenario,
  insertSimulationRun,
  findSimulationRun,
} from "../queries/scenarios";
import { insertJob } from "../queries/admin";
import { jobRunner, enqueuePersistedJob } from "../runner";
import {
  computeReproducibilityHash,
  stableStringify,
  type SimulationRunManifest,
} from "../utils/manifest";

/**
 * DM-3 / TEST-5: gateway simulation runs persist a reproducibility manifest
 * (inputs, dataset snapshot id, code version) and a reproducibility hash;
 * the re-run harness recomputes the hash from persisted columns and from a
 * second execution of the same manifest.
 */
async function runSimulationOnce(tag: string) {
  const scenarioId = `scn:ng-kd:manifest-${tag}-${nanoid(6)}`;
  await insertScenario({
    scenarioId,
    jurisdictionId: "jur:ng-kd",
    name: "Manifest test scenario",
    status: "draft",
    version: 1,
    createdBy: null,
  });
  const simulationRunId = `sim:${nanoid(10)}`;
  await insertSimulationRun({
    simulationRunId,
    scenarioId,
    engine: "forecast",
    executionProfile: {},
    modelVersions: {},
    status: "queued",
    progress: 0,
    seed: 42,
    startedAt: new Date(),
  });
  const jobId = `job:${nanoid(16)}`;
  await insertJob({
    jobId,
    type: "simulations.run",
    status: "queued",
    progress: 0,
    input: { simulation_run_id: simulationRunId, actor_id: null },
    idempotencyKey: `test-manifest-${nanoid(10)}`,
    actorId: null,
  });
  await enqueuePersistedJob(jobId);
  await jobRunner.drain();
  const run = await findSimulationRun(simulationRunId);
  expect(run, "run row").toBeTruthy();
  return run!;
}

describe("simulation run reproducibility manifest (DM-3)", () => {
  it("persists manifest, dataset_snapshot_id and reproducibility_hash", async () => {
    const run = await runSimulationOnce("persist");
    expect(run.status).toBe("succeeded");
    const manifest = run.manifest as SimulationRunManifest;
    expect(manifest).toBeTruthy();
    expect(manifest.manifest_version).toBe(1);
    expect(manifest.engine).toBe("forecast");
    expect(manifest.seed).toBe(42);
    expect(manifest.jurisdiction_id).toBe("jur:ng-kd");
    expect(run.datasetSnapshotId).toBe(manifest.dataset_snapshot_id);
    expect(run.datasetSnapshotId).toMatch(/^snap:[0-9a-f]{16}$/);
    // The persisted hash recomputes exactly from persisted columns.
    expect(run.reproducibilityHash).toMatch(/^[0-9a-f]{64}$/);
    expect(run.reproducibilityHash).toBe(
      computeReproducibilityHash(manifest, run.resultSummary),
    );
  }, 30_000);

  it("re-run harness: same manifest inputs reproduce the same hash", async () => {
    // Two runs of identical scenarios (same inputs => same snapshot id),
    // and the deterministic engine yields identical reproducibility hashes.
    const a = await runSimulationOnce("rerun");
    const b = await runSimulationOnce("rerun");
    expect(a.datasetSnapshotId).toBe(b.datasetSnapshotId);
    const manifestA = a.manifest as SimulationRunManifest;
    const manifestB = b.manifest as SimulationRunManifest;
    // stableStringify is key-order independent
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 2 }, b: 1 }),
    );
    // Results are deterministic given the same seed/inputs.
    expect(stableStringify(a.resultSummary)).toBe(stableStringify(b.resultSummary));
    expect(
      computeReproducibilityHash(
        { ...manifestA, simulation_run_id: "sim:x", scenario_id: "scn:x" },
        a.resultSummary,
      ),
    ).toBe(
      computeReproducibilityHash(
        { ...manifestB, simulation_run_id: "sim:x", scenario_id: "scn:x" },
        b.resultSummary,
      ),
    );
  }, 60_000);
});
