import { createHash } from "node:crypto";
import type { SimulationEngine } from "@contracts/entities";
import { runFallbackEngine, type ScenarioRunRequest } from "./simulation";

/**
 * SIM-5: walk-forward calibration harness over the platform's engine layer.
 *
 * The digital twin's realized record for a jurisdiction is the full-horizon
 * deterministic engine series (same seed ⇒ same history, mirroring
 * services/simulation seed data). For every cutoff window each engine is
 * "trained" on months ≤ cutoff and projected forward; the projection is
 * scored against the realized post-cutoff segment with:
 *   - MAPE / RMSE
 *   - coverage_80 — share of realized points inside the projected 80% band
 *   - skill_vs_naive — 1 − RMSE/RMSE_naive (naive = persistence of last
 *     training value)
 * All pure functions of the seed — deterministic and unit-testable.
 */

export const BACKTEST_HORIZON_MONTHS = 36;
export const WALK_FORWARD_CUTOFFS = [12, 18, 24, 30];
export const BAND_LEVEL = 0.8;
/** z for an 80% two-sided interval (matches the fallback band's 1.28). */
export const Z80 = 1.2815515655446004;

export interface CalibrationPoint {
  month: number;
  actual: number;
  projected: number;
  lower: number;
  upper: number;
}

export interface WindowCalibration {
  cutoff_month: number;
  mape: number;
  rmse: number;
  coverage_80: number;
  skill_vs_naive: number;
  series: CalibrationPoint[];
}

export interface EngineCalibrationRow {
  engine: SimulationEngine;
  windows: WindowCalibration[];
  mape_mean: number;
  rmse_mean: number;
  coverage_80_mean: number;
  skill_vs_naive_mean: number;
}

export interface CalibrationReportData {
  jurisdiction_id: string;
  horizon_months: number;
  cutoffs: number[];
  band_level: number;
  seed: number;
  engines: EngineCalibrationRow[];
  report_hash: string;
}

/* ------------------------------------------------------------------ */
/* Pure metrics                                                        */
/* ------------------------------------------------------------------ */

export function mape(actual: number[], predicted: number[]): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] !== 0) {
      sum += Math.abs((actual[i] - predicted[i]) / actual[i]);
      n += 1;
    }
  }
  return n > 0 ? (sum / n) * 100 : 0;
}

export function rmse(actual: number[], predicted: number[]): number {
  if (actual.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < actual.length; i++) {
    sum += (actual[i] - predicted[i]) ** 2;
  }
  return Math.sqrt(sum / actual.length);
}

/** Share of actuals inside [lower, upper] (0..1). */
export function bandCoverage(
  actual: number[],
  lower: number[],
  upper: number[],
): number {
  if (actual.length === 0) return 0;
  let inside = 0;
  for (let i = 0; i < actual.length; i++) {
    if (actual[i] >= lower[i] && actual[i] <= upper[i]) inside += 1;
  }
  return inside / actual.length;
}

/** 1 − RMSE_model/RMSE_naive; 1 perfect, 0 parity, <0 worse than naive. */
export function skillScore(modelRmse: number, naiveRmse: number): number {
  if (naiveRmse <= 0) return modelRmse <= 0 ? 1 : 0;
  return 1 - modelRmse / naiveRmse;
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;

/* ------------------------------------------------------------------ */
/* Walk-forward evaluation                                             */
/* ------------------------------------------------------------------ */

/**
 * Evaluate one engine over all cutoff windows. The twin's realized series is
 * the engine's full-horizon output; the "trained" projection at a cutoff
 * extends the engine's pre-cutoff trajectory (last observed drift) with an
 * 80% band whose spread grows with √horizon from the trained band's width.
 */
export function walkForwardEngine(
  base: ScenarioRunRequest,
  cutoffs: number[] = WALK_FORWARD_CUTOFFS,
  horizon: number = BACKTEST_HORIZON_MONTHS,
): WindowCalibration[] {
  const actual = runFallbackEngine({ ...base, horizon_months: horizon });
  const windows: WindowCalibration[] = [];
  for (const cutoff of cutoffs) {
    if (cutoff < 1 || cutoff >= horizon) continue;
    const trained = runFallbackEngine({ ...base, horizon_months: cutoff });
    const last = trained.series[trained.series.length - 1];
    const prev = trained.series[trained.series.length - 2] ?? last;
    const drift = last.mean - prev.mean;
    const sigmaLast = (last.upper - last.lower) / (2 * Z80) || 1;
    const series: CalibrationPoint[] = [];
    for (let m = cutoff + 1; m <= horizon; m++) {
      const h = m - cutoff;
      const projected = last.mean + drift * h;
      const sigma = sigmaLast * Math.sqrt(h);
      series.push({
        month: m,
        actual: actual.series[m]?.mean ?? 0,
        projected: Math.round(projected),
        lower: Math.round(projected - Z80 * sigma),
        upper: Math.round(projected + Z80 * sigma),
      });
    }
    const actuals = series.map((p) => p.actual);
    const projected = series.map((p) => p.projected);
    const naive = series.map(() => last.mean);
    const modelRmse = rmse(actuals, projected);
    windows.push({
      cutoff_month: cutoff,
      mape: round4(mape(actuals, projected)),
      rmse: round4(modelRmse),
      coverage_80: round4(
        bandCoverage(
          actuals,
          series.map((p) => p.lower),
          series.map((p) => p.upper),
        ),
      ),
      skill_vs_naive: round4(skillScore(modelRmse, rmse(actuals, naive))),
      series,
    });
  }
  return windows;
}

const mean = (xs: number[]) =>
  xs.length ? round4(xs.reduce((s, x) => s + x, 0) / xs.length) : 0;

/** Full per-engine calibration table for a jurisdiction. */
export function calibrationReport(
  jurisdictionId: string,
  engines: SimulationEngine[],
  seed = 42,
  cutoffs: number[] = WALK_FORWARD_CUTOFFS,
): CalibrationReportData {
  // Baseline employment the engines perturb: deterministic per jurisdiction
  // (pilot geographies mirror services/simulation seed jurisdictions).
  const baselines: Record<string, number> = {
    "jur:ng": 51_500_000,
    "jur:ng-kd": 2_213_400,
    "jur:ng-la": 7_106_400,
    "jur:ng-kn": 3_164_800,
  };
  const baselineEmployment = baselines[jurisdictionId] ?? 3_600_000;
  const rows: EngineCalibrationRow[] = engines.map((engine) => {
    const base: ScenarioRunRequest = {
      scenario_id: `backtest:${jurisdictionId}`,
      engine,
      seed,
      horizon_months: BACKTEST_HORIZON_MONTHS,
      baseline_employment: baselineEmployment,
      intervention_strength: 0.5,
    };
    const windows = walkForwardEngine(base, cutoffs);
    return {
      engine,
      windows,
      mape_mean: mean(windows.map((w) => w.mape)),
      rmse_mean: mean(windows.map((w) => w.rmse)),
      coverage_80_mean: mean(windows.map((w) => w.coverage_80)),
      skill_vs_naive_mean: mean(windows.map((w) => w.skill_vs_naive)),
    };
  });
  const report_hash = createHash("sha256")
    .update(JSON.stringify({ jurisdictionId, seed, cutoffs, rows }))
    .digest("hex");
  return {
    jurisdiction_id: jurisdictionId,
    horizon_months: BACKTEST_HORIZON_MONTHS,
    cutoffs: [...cutoffs],
    band_level: BAND_LEVEL,
    seed,
    engines: rows,
    report_hash,
  };
}
