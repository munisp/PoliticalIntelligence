import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import {
  computeMilestoneVariance,
  corridorProgressOutput,
  corridorVarianceOutput,
  type CorridorMilestoneView,
} from "@contracts/corridors";
import {
  CORRIDOR_ID,
  CORRIDOR_MILESTONES,
  seedLagosCalabar,
} from "@db/seed-lagos-calabar";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import type { TrpcContext } from "../context";

const db = getDb();

beforeAll(async () => {
  await seedLagosCalabar();
}, 60000);

function anonCtx(): TrpcContext {
  return { req: new Request("http://test.local/"), resHeaders: new Headers() };
}

describe("I3 — corridor milestones seed", () => {
  it("seeds ≥8 Lagos–Calabar milestones, idempotently", async () => {
    const rows = await db
      .select()
      .from(schema.corridorMilestones)
      .where(eq(schema.corridorMilestones.corridorId, CORRIDOR_ID));
    expect(rows.length).toBe(CORRIDOR_MILESTONES.length);
    expect(rows.length).toBeGreaterThanOrEqual(8);
    const ids = rows.map((r) => r.milestoneId);
    // Required coverage from the brief.
    expect(ids).toContain("ms:lch-s1-financing-close");
    expect(ids).toContain("ms:lch-s1-commissioning");
    expect(ids).toContain("ms:lch-s2-financing");
    expect(ids).toContain("ms:lch-esia-disclosure");
    expect(ids).toContain("ms:lch-solar-lighting-pilot");
    expect(ids).toContain("ms:lch-rail-median-study");
    expect(ids).toContain("ms:lch-full-corridor-2030");
    // Idempotency: re-seed keeps the count.
    await seedLagosCalabar();
    const rows2 = await db
      .select()
      .from(schema.corridorMilestones)
      .where(eq(schema.corridorMilestones.corridorId, CORRIDOR_ID));
    expect(rows2.length).toBe(rows.length);
  }, 60000);
});

describe("I3 — deterministic variance math", () => {
  const base: CorridorMilestoneView = {
    milestoneId: "ms:test",
    corridorId: "corridor:test",
    title: "Test milestone",
    plannedDate: "2025-01-01",
    actualDate: null,
    status: "in_progress",
    pctComplete: 50,
    fundingDisbursedNgn: null,
    evidenceRef: null,
  };

  it("schedule variance is actual-minus-planned in days", () => {
    const v = computeMilestoneVariance(
      { ...base, actualDate: "2025-01-11", status: "done" },
      0,
      1,
      new Date("2025-02-01"),
    );
    expect(v.scheduleVarianceDays).toBe(10);
    expect(v.daysOverdue).toBe(0); // done milestones are never overdue
  });

  it("unfinished milestones accrue overdue days after plannedDate", () => {
    const v = computeMilestoneVariance(base, 0, 1, new Date("2025-01-31"));
    expect(v.scheduleVarianceDays).toBeNull();
    expect(v.daysOverdue).toBe(30);
  });

  it("funding variance compares disbursement to the linear pro-rata share", () => {
    // 2 milestones, ₦100 total → share ₦50; 50% complete → expected ₦25.
    const v = computeMilestoneVariance(
      { ...base, fundingDisbursedNgn: 40 },
      100,
      2,
      new Date("2025-01-31"),
    );
    expect(v.fundingVarianceNgn).toBe(15);
    // No planned envelope → variance is null (not misleading zero).
    const v0 = computeMilestoneVariance(
      { ...base, fundingDisbursedNgn: 40 },
      0,
      2,
      new Date("2025-01-31"),
    );
    expect(v0.fundingVarianceNgn).toBeNull();
  });
});

describe("I3 — corridors.progress / corridors.variance", () => {
  it("progress returns milestones + aggregate and validates the contract", async () => {
    const caller = appRouter.createCaller(anonCtx());
    const res = await caller.corridors.progress({ corridor_id: CORRIDOR_ID });
    const parsed = corridorProgressOutput.parse(res.data);
    expect(parsed.milestones.length).toBeGreaterThanOrEqual(8);
    expect(parsed.aggregate.milestoneCount).toBe(parsed.milestones.length);
    expect(parsed.aggregate.aggregatePct).toBeGreaterThan(0);
    expect(parsed.aggregate.done).toBeGreaterThanOrEqual(5);
    expect(parsed.aggregate.totalDisbursedNgn).toBeGreaterThan(0);
    expect(parsed.aggregate.totalPlannedNgn).toBe(2_903_150_000_000);
    expect(parsed.aggregate.disbursedVsPlanned).toBeGreaterThan(0);
    expect(parsed.aggregate.disbursedVsPlanned).toBeLessThanOrEqual(1);
    // Milestones are ordered by plannedDate (timeline contract).
    const dates = parsed.milestones.map((m) => m.plannedDate);
    expect([...dates].sort()).toEqual(dates);
  });

  it("variance returns per-milestone schedule/funding variance", async () => {
    const caller = appRouter.createCaller(anonCtx());
    const res = await caller.corridors.variance({ corridor_id: CORRIDOR_ID });
    const parsed = corridorVarianceOutput.parse(res.data);
    expect(parsed.variances.length).toBeGreaterThanOrEqual(8);
    const esia = parsed.variances.find((v) => v.milestoneId === "ms:lch-esia-disclosure");
    // Planned 2024-06-30, actual 2024-09-15 → 77 days slip.
    expect(esia?.scheduleVarianceDays).toBe(77);
    const s1 = parsed.variances.find((v) => v.milestoneId === "ms:lch-s1-commissioning");
    expect(s1?.scheduleVarianceDays).toBe(0);
    expect(parsed.totals.maxScheduleSlipDays).toBeGreaterThanOrEqual(77);
  });
});
