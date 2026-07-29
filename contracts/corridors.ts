import { z } from "zod";

/**
 * I3 — Corridor Twin contracts (docs/INNOVATIONS.md §I3).
 * Delivery milestones with schedule/funding variance analytics. All
 * variance math is deterministic (pure functions of stored milestones).
 */

export const CORRIDOR_STATUSES = ["planned", "in_progress", "done", "delayed"] as const;
export const corridorStatusSchema = z.enum(CORRIDOR_STATUSES);
export type CorridorStatus = z.infer<typeof corridorStatusSchema>;

export const corridorMilestoneSchema = z.object({
  milestoneId: z.string(),
  corridorId: z.string(),
  title: z.string(),
  /** ISO date labels (YYYY-MM-DD). */
  plannedDate: z.string(),
  actualDate: z.string().nullable(),
  status: corridorStatusSchema,
  pctComplete: z.number().min(0).max(100),
  fundingDisbursedNgn: z.number().nullable(),
  evidenceRef: z.string().nullable(),
});
export type CorridorMilestoneView = z.infer<typeof corridorMilestoneSchema>;

export const corridorProgressInput = z.object({
  corridor_id: z.string().min(1).max(96),
});

export const corridorProgressOutput = z.object({
  corridorId: z.string(),
  milestones: z.array(corridorMilestoneSchema),
  aggregate: z.object({
    milestoneCount: z.number().int().nonnegative(),
    /** Simple mean of pctComplete across milestones. */
    aggregatePct: z.number().min(0).max(100),
    done: z.number().int().nonnegative(),
    inProgress: z.number().int().nonnegative(),
    delayed: z.number().int().nonnegative(),
    planned: z.number().int().nonnegative(),
    totalDisbursedNgn: z.number().nonnegative(),
    totalPlannedNgn: z.number().nonnegative(),
    /** disbursed / planned in [0,∞); 0 when nothing planned. */
    disbursedVsPlanned: z.number().nonnegative(),
  }),
});
export type CorridorProgressOutput = z.infer<typeof corridorProgressOutput>;

export const milestoneVarianceSchema = z.object({
  milestoneId: z.string(),
  title: z.string(),
  status: corridorStatusSchema,
  /** actualDate - plannedDate in days; null when no actual date yet. */
  scheduleVarianceDays: z.number().nullable(),
  /** Days past plannedDate for unfinished milestones; 0 when on time. */
  daysOverdue: z.number().nonnegative(),
  /** disbursed - pct-expected (disbursed minus linear pro-rata share). */
  fundingVarianceNgn: z.number().nullable(),
});
export type MilestoneVariance = z.infer<typeof milestoneVarianceSchema>;

export const corridorVarianceOutput = z.object({
  corridorId: z.string(),
  variances: z.array(milestoneVarianceSchema),
  totals: z.object({
    maxScheduleSlipDays: z.number(),
    milestonesOverdue: z.number().int().nonnegative(),
    totalFundingVarianceNgn: z.number(),
  }),
});
export type CorridorVarianceOutput = z.infer<typeof corridorVarianceOutput>;

/* ------------------------------------------------------------------ */
/* Deterministic variance math (shared by API + tests)                 */
/* ------------------------------------------------------------------ */

const DAY_MS = 24 * 3600 * 1000;

function parseDate(d: string): number {
  return new Date(`${d.slice(0, 10)}T00:00:00Z`).getTime();
}

export function computeMilestoneVariance(
  m: CorridorMilestoneView,
  plannedTotalNgn: number,
  milestoneCount: number,
  now: Date = new Date(),
): MilestoneVariance {
  const planned = parseDate(m.plannedDate);
  const scheduleVarianceDays = m.actualDate
    ? Math.round((parseDate(m.actualDate) - planned) / DAY_MS)
    : null;
  const daysOverdue =
    m.status === "done" ? 0 : Math.max(0, Math.round((now.getTime() - planned) / DAY_MS));
  // Linear pro-rata expectation: each milestone "should" have drawn
  // (pctComplete/100) × equal share of the corridor total.
  const share = milestoneCount > 0 ? plannedTotalNgn / milestoneCount : 0;
  const fundingVarianceNgn =
    m.fundingDisbursedNgn == null || plannedTotalNgn === 0
      ? null
      : Math.round((m.fundingDisbursedNgn - (m.pctComplete / 100) * share) * 100) / 100;
  return {
    milestoneId: m.milestoneId,
    title: m.title,
    status: m.status,
    scheduleVarianceDays,
    daysOverdue,
    fundingVarianceNgn,
  };
}
