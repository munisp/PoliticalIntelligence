import {
  type BandPoint,
  type SimulationEngine,
  type SimulationResultSummary,
} from "@contracts/entities";
import { mulberry32, normal } from "../utils/prng";

/**
 * Bridge to services/simulation (Python FastAPI worker).
 * POST /v1/scenario-runs → {run_id, status}
 * GET  /v1/scenario-runs/:id → {run_id, status, result}
 * Falls back to deterministic in-process mini-engines (seeded PRNG) when the
 * service is unreachable (5s timeout) so the platform stays production-ready
 * without the Python worker. Same seed ⇒ same result.
 */

const BASE_URL = process.env.SIMULATION_BASE_URL ?? "http://localhost:8100";
const TIMEOUT_MS = 5000;

export interface ScenarioRunRequest {
  scenario_id: string;
  engine: SimulationEngine;
  seed: number;
  horizon_months: number;
  /** Baseline employment level the engines perturb. */
  baseline_employment: number;
  /** Aggregate intervention strength 0..1 (jobs pressure). */
  intervention_strength: number;
  execution_profile?: Record<string, unknown>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`simulation service ${resp.status}`);
    return (await resp.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Deterministic in-process fallback engines                           */
/* ------------------------------------------------------------------ */

function band(month: number, mean: number, spread: number): BandPoint {
  return {
    month,
    mean: Math.round(mean),
    lower: Math.round(mean - 1.28 * spread),
    upper: Math.round(mean + 1.28 * spread),
  };
}

function forecastEngine(req: ScenarioRunRequest): SimulationResultSummary {
  const rand = mulberry32(req.seed);
  const monthlyGain =
    (req.baseline_employment * 0.002 + 400) * (0.5 + req.intervention_strength);
  const series: BandPoint[] = [];
  let level = req.baseline_employment;
  for (let m = 0; m <= req.horizon_months; m++) {
    if (m > 0) level += monthlyGain * (1 + 0.15 * normal(rand));
    series.push(band(m, level, 0.06 * level + 250 * Math.sqrt(m + 1)));
  }
  return {
    engine: "forecast",
    metric: "employment",
    unit: "jobs",
    series,
    extras: { model: "local-level trend + intervention impulse" },
    seed: req.seed,
    model_versions: { fallback_forecast: "1.0.0" },
  };
}

function causalEngine(req: ScenarioRunRequest): SimulationResultSummary {
  const rand = mulberry32(req.seed + 7);
  // Synthetic DID: treatment lifts employment by att after month 3.
  const att = Math.round(
    (1500 + 9000 * req.intervention_strength) * (1 + 0.1 * normal(rand)),
  );
  const series: BandPoint[] = [];
  for (let m = 0; m <= req.horizon_months; m++) {
    const treated = m <= 3 ? 0 : att * (1 - Math.exp(-(m - 3) / 6));
    series.push(band(m, treated, 0.18 * Math.abs(treated) + 120));
  }
  return {
    engine: "causal",
    metric: "employment_effect",
    unit: "jobs",
    series,
    extras: { average_treatment_effect: att, method: "synthetic-did" },
    seed: req.seed,
    model_versions: { fallback_causal: "1.0.0" },
  };
}

function microsimEngine(req: ScenarioRunRequest): SimulationResultSummary {
  const rand = mulberry32(req.seed + 13);
  const takeup = 0.08 + 0.35 * req.intervention_strength;
  const series: BandPoint[] = [];
  for (let m = 0; m <= req.horizon_months; m++) {
    const newlyFormal = Math.round(
      (req.baseline_employment * takeup * (m / req.horizon_months) * 0.05) *
        (1 + 0.1 * normal(rand)),
    );
    series.push(band(m, newlyFormal, 0.22 * Math.abs(newlyFormal) + 60));
  }
  const deciles = Array.from({ length: 10 }, (_, i) => ({
    decile: i + 1,
    avg_gain: Math.round((i + 1) * 120 * takeup * (1 + 0.2 * normal(rand))),
  }));
  return {
    engine: "microsim",
    metric: "newly_formalized_workers",
    unit: "workers",
    series,
    extras: { takeup_rate: takeup, distribution: deciles },
    seed: req.seed,
    model_versions: { fallback_microsim: "1.0.0" },
  };
}

function abmEngine(req: ScenarioRunRequest): SimulationResultSummary {
  const rand = mulberry32(req.seed + 29);
  const series: BandPoint[] = [];
  let employed = 0;
  for (let m = 0; m <= req.horizon_months; m++) {
    if (m > 0) {
      const hires = Math.round(
        300 * req.intervention_strength * 12 * (0.7 + rand()) +
          0.002 * employed,
      );
      const exits = Math.round(0.01 * employed * rand());
      employed = Math.max(0, employed + hires - exits);
    }
    series.push(band(m, employed, 0.12 * employed + 100));
  }
  return {
    engine: "abm",
    metric: "employment_path",
    unit: "jobs",
    series,
    extras: { agents: 5000, firms: 240 },
    seed: req.seed,
    model_versions: { fallback_abm: "1.0.0" },
  };
}

function systemDynamicsEngine(req: ScenarioRunRequest): SimulationResultSummary {
  const rand = mulberry32(req.seed + 43);
  const series: BandPoint[] = [];
  let stock = req.baseline_employment * 0.02; // trained-workers stock
  const capacity = req.baseline_employment * (0.05 + 0.2 * req.intervention_strength);
  for (let m = 0; m <= req.horizon_months; m++) {
    if (m > 0) {
      const inflow = 0.06 * (capacity - stock) * (1 + 0.05 * normal(rand));
      stock = Math.max(0, stock + inflow - 0.01 * stock);
    }
    series.push(band(m, stock, 0.1 * stock + 80));
  }
  return {
    engine: "system_dynamics",
    metric: "skilled_labour_stock",
    unit: "workers",
    series,
    extras: { stocks: ["skilled_labour", "training_capacity"], capacity },
    seed: req.seed,
    model_versions: { fallback_sd: "1.0.0" },
  };
}

function optimizationEngine(req: ScenarioRunRequest): SimulationResultSummary {
  const rand = mulberry32(req.seed + 59);
  const instruments = [
    "teacher_pipeline",
    "school_meals_sourcing",
    "procurement_supplier_dev",
    "sme_formalization",
    "agro_clusters",
  ];
  const budget = 25000; // ₦m envelope
  let remaining = budget;
  const portfolio = instruments.map((name, i) => {
    const alloc =
      i === instruments.length - 1
        ? remaining
        : Math.round(remaining * (0.15 + 0.25 * rand()));
    remaining -= alloc;
    return {
      instrument: name,
      allocation_ngn_m: alloc,
      expected_jobs: Math.round(alloc * (1.1 + 0.6 * req.intervention_strength)),
    };
  });
  const totalJobs = portfolio.reduce((s, p) => s + p.expected_jobs, 0);
  const series: BandPoint[] = [];
  for (let m = 0; m <= req.horizon_months; m++) {
    const deployed = totalJobs * (m / req.horizon_months);
    series.push(band(m, deployed, 0.08 * deployed + 150));
  }
  return {
    engine: "optimization",
    metric: "portfolio_employment",
    unit: "jobs",
    series,
    extras: { budget_ngn_m: budget, portfolio },
    seed: req.seed,
    model_versions: { fallback_opt: "1.0.0" },
  };
}

const FALLBACK_ENGINES: Record<
  SimulationEngine,
  (req: ScenarioRunRequest) => SimulationResultSummary
> = {
  forecast: forecastEngine,
  causal: causalEngine,
  microsim: microsimEngine,
  abm: abmEngine,
  system_dynamics: systemDynamicsEngine,
  optimization: optimizationEngine,
};

/** Run the deterministic in-process engine directly (also used by tests). */
export function runFallbackEngine(
  req: ScenarioRunRequest,
): SimulationResultSummary {
  return FALLBACK_ENGINES[req.engine](req);
}

export interface ScenarioRunResult {
  result: SimulationResultSummary;
  /** "remote" when the Python service answered, "fallback" otherwise. */
  bridge: "remote" | "fallback";
}

/**
 * Submit a scenario run. Tries the simulation service first; on any failure
 * (connection refused, timeout, non-2xx) executes the deterministic fallback.
 */
export async function executeScenarioRun(
  req: ScenarioRunRequest,
): Promise<ScenarioRunResult> {
  try {
    const submitted = await postJson<{ run_id: string; status: string }>(
      "/v1/scenario-runs",
      req,
    );
    // Poll briefly for completion (service runs are fast in dev).
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(
        `${BASE_URL}/v1/scenario-runs/${submitted.run_id}`,
        { signal: ctrl.signal },
      );
      if (!resp.ok) throw new Error(`simulation service ${resp.status}`);
      const done = (await resp.json()) as {
        status: string;
        result?: SimulationResultSummary;
      };
      if (done.status === "succeeded" && done.result) {
        return { result: done.result, bridge: "remote" };
      }
      throw new Error(`remote run status ${done.status}`);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { result: runFallbackEngine(req), bridge: "fallback" };
  }
}
