import { describe, expect, it, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import {
  BAND_LEVEL,
  WALK_FORWARD_CUTOFFS,
  bandCoverage,
  calibrationReport,
  mape,
  rmse,
  skillScore,
  walkForwardEngine,
} from "../bridges/backtest";
import { SIMULATION_ENGINES } from "@contracts/entities";
import type { TrpcContext } from "../context";
import type { User } from "@db/schema";

beforeAll(() => {
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

describe("SIM-5 walk-forward calibration harness (bridges/backtest)", () => {
  it("metrics are correct on known values", () => {
    expect(mape([100, 200, 400], [110, 180, 400])).toBeCloseTo(20 / 3, 6);
    expect(rmse([1, 2, 3], [1, 4, 3])).toBeCloseTo(Math.sqrt(4 / 3), 9);
    // coverage: all inside → 1; band shifted below actuals → 0
    expect(bandCoverage([10, 20, 30], [5, 15, 25], [15, 25, 35])).toBe(1);
    expect(bandCoverage([10, 20, 30], [0, 0, 0], [1, 1, 1])).toBe(0);
    // partial: 2,3,4,5,6 of 0..9 → 0.5
    expect(
      bandCoverage(
        Array.from({ length: 10 }, (_, i) => i),
        Array(10).fill(2),
        Array(10).fill(6),
      ),
    ).toBe(0.5);
    expect(skillScore(0, 1)).toBe(1);
    expect(skillScore(1, 1)).toBe(0);
    expect(skillScore(2, 1)).toBe(-1);
    expect(skillScore(0.5, 2)).toBeCloseTo(0.75);
  });

  it("walk-forward uses multiple cutoff windows with no train/test leakage", () => {
    const windows = walkForwardEngine({
      scenario_id: "backtest:test",
      engine: "forecast",
      seed: 42,
      horizon_months: 36,
      baseline_employment: 3_600_000,
      intervention_strength: 0.5,
    });
    expect(windows.length).toBe(WALK_FORWARD_CUTOFFS.length);
    expect(WALK_FORWARD_CUTOFFS.length).toBeGreaterThanOrEqual(3);
    for (const w of windows) {
      // every scored month is strictly after the cutoff
      expect(w.series[0].month).toBe(w.cutoff_month + 1);
      expect(w.series.length).toBe(36 - w.cutoff_month);
      expect(w.coverage_80).toBeGreaterThanOrEqual(0);
      expect(w.coverage_80).toBeLessThanOrEqual(1);
      expect(w.mape).toBeGreaterThanOrEqual(0);
      expect(w.rmse).toBeGreaterThanOrEqual(0);
      // band brackets the projection
      for (const p of w.series) {
        expect(p.lower).toBeLessThanOrEqual(p.projected);
        expect(p.upper).toBeGreaterThanOrEqual(p.projected);
      }
    }
  });

  it("calibration report covers all six engines and is deterministic", () => {
    const r1 = calibrationReport("jur:ng-kd", [...SIMULATION_ENGINES], 42);
    const r2 = calibrationReport("jur:ng-kd", [...SIMULATION_ENGINES], 42);
    expect(r1.engines.map((e) => e.engine)).toEqual([...SIMULATION_ENGINES]);
    expect(r1.report_hash).toBe(r2.report_hash);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    expect(r1.band_level).toBe(BAND_LEVEL);
    for (const row of r1.engines) {
      expect(row.windows.length).toBe(WALK_FORWARD_CUTOFFS.length);
      expect(row.coverage_80_mean).toBeGreaterThanOrEqual(0);
      expect(row.coverage_80_mean).toBeLessThanOrEqual(1);
      expect(row.skill_vs_naive_mean).toBeLessThanOrEqual(1);
    }
    // different seed or jurisdiction → different hash
    expect(calibrationReport("jur:ng-kd", [...SIMULATION_ENGINES], 7).report_hash)
      .not.toBe(r1.report_hash);
    expect(calibrationReport("jur:ng-la", [...SIMULATION_ENGINES], 42).report_hash)
      .not.toBe(r1.report_hash);
  });

  it("calibrationReport procedure surfaces windows + per-engine table in the envelope", async () => {
    const caller = appRouter.createCaller(await adminCtx());
    const res = await caller.innovations.calibrationReport({
      jurisdiction_id: "jur:ng-kd",
      seed: 42,
    });
    const d = res.data;
    expect(d.jurisdiction_id).toBe("jur:ng-kd");
    expect(d.cutoffs).toEqual(WALK_FORWARD_CUTOFFS);
    expect(d.engines.length).toBe(6);
    expect(d.report_hash).toMatch(/^[0-9a-f]{64}$/);
    const forecast = d.engines.find((e) => e.engine === "forecast")!;
    expect(forecast.windows.length).toBeGreaterThanOrEqual(3);
    expect(forecast.windows[0].series[0].month).toBe(
      forecast.windows[0].cutoff_month + 1,
    );
    expect(forecast.mape_mean).toBeGreaterThanOrEqual(0);
    expect(forecast.coverage_80_mean).toBeGreaterThanOrEqual(0);
    expect(forecast.coverage_80_mean).toBeLessThanOrEqual(1);
    expect(res.meta.request_id).toBeTruthy();
    // deterministic across calls
    const again = await caller.innovations.calibrationReport({
      jurisdiction_id: "jur:ng-kd",
      seed: 42,
    });
    expect(again.data).toEqual(d);
  });

  it("calibrationReport respects engine subset selection", async () => {
    const caller = appRouter.createCaller(await adminCtx());
    const res = await caller.innovations.calibrationReport({
      jurisdiction_id: "jur:ng-kd",
      engines: ["forecast", "abm"],
      seed: 42,
    });
    expect(res.data.engines.map((e) => e.engine)).toEqual(["forecast", "abm"]);
  });
});
