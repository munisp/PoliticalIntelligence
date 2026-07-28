import { createHash } from "node:crypto";

/**
 * DM-3 simulation-run reproducibility: a persisted manifest capturing every
 * input needed to re-run a simulation, plus a content hash over
 * manifest + result so re-runs can be verified bit-for-bit.
 */

/** Deterministic JSON: object keys sorted recursively. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export interface SimulationRunManifest {
  manifest_version: 1;
  simulation_run_id: string;
  scenario_id: string;
  jurisdiction_id: string | null;
  engine: string;
  seed: number;
  horizon_months: number;
  baseline_employment: number;
  intervention_strength: number;
  execution_profile: Record<string, unknown>;
  model_versions: Record<string, unknown>;
  /** Content-addressed snapshot of the run inputs. */
  dataset_snapshot_id: string;
  /** Code version that produced the run (git sha when available). */
  code_version: string;
  created_at: string;
}

/** Content hash of the full input dataset/config slice for a run. */
export function computeDatasetSnapshotId(input: {
  jurisdiction_id: string | null;
  engine: string;
  seed: number;
  horizon_months: number;
  baseline_employment: number;
  intervention_strength: number;
  execution_profile: Record<string, unknown>;
  model_versions: Record<string, unknown>;
}): string {
  return `snap:${sha256Hex(stableStringify(input)).slice(0, 16)}`;
}

export function buildSimulationRunManifest(args: {
  simulation_run_id: string;
  scenario_id: string;
  jurisdiction_id: string | null;
  engine: string;
  seed: number;
  horizon_months: number;
  baseline_employment: number;
  intervention_strength: number;
  execution_profile: Record<string, unknown>;
  model_versions: Record<string, unknown>;
}): SimulationRunManifest {
  const dataset_snapshot_id = computeDatasetSnapshotId({
    jurisdiction_id: args.jurisdiction_id,
    engine: args.engine,
    seed: args.seed,
    horizon_months: args.horizon_months,
    baseline_employment: args.baseline_employment,
    intervention_strength: args.intervention_strength,
    execution_profile: args.execution_profile,
    model_versions: args.model_versions,
  });
  return {
    manifest_version: 1,
    simulation_run_id: args.simulation_run_id,
    scenario_id: args.scenario_id,
    jurisdiction_id: args.jurisdiction_id,
    engine: args.engine,
    seed: args.seed,
    horizon_months: args.horizon_months,
    baseline_employment: args.baseline_employment,
    intervention_strength: args.intervention_strength,
    execution_profile: args.execution_profile,
    model_versions: args.model_versions,
    dataset_snapshot_id,
    code_version: process.env.GIT_SHA ?? "dev",
    created_at: new Date().toISOString(),
  };
}

/**
 * Reproducibility hash over manifest (minus volatile created_at) + result.
 * A re-run with the same manifest must produce the same hash; the verifier
 * recomputes this from persisted columns (TEST-5).
 */
export function computeReproducibilityHash(
  manifest: SimulationRunManifest,
  resultSummary: unknown,
): string {
  const { created_at: _ignored, ...stableManifest } = manifest;
  return sha256Hex(stableStringify({ manifest: stableManifest, result: resultSummary }));
}
