import {
  computeMilestoneVariance,
  corridorProgressInput,
  corridorProgressOutput,
  corridorVarianceOutput,
  type CorridorMilestoneView,
} from "@contracts/corridors";
import { createRouter, publicQuery } from "./middleware";
import { envelope } from "./utils/envelope";
import { listCorridorIds, milestonesForCorridor } from "./queries/corridors";

/**
 * I3 — Corridor Twin (docs/INNOVATIONS.md §I3): milestone progress and
 * deterministic schedule/funding variance for infrastructure corridors
 * (seeded: Lagos–Calabar coastal highway, corridor:lagos-calabar).
 * Reads are public reference data (same tier as outcomes listSeries).
 */

/** Planned ₦ envelope per corridor: $1.873B (S1 $747M + S2 $1.126B) at ~₦1,550/$. */
const CORRIDOR_PLANNED_NGN: Record<string, number> = {
  "corridor:lagos-calabar": 2_903_150_000_000,
};

function toView(m: {
  milestoneId: string;
  corridorId: string;
  title: string;
  plannedDate: string;
  actualDate: string | null;
  status: CorridorMilestoneView["status"];
  pctComplete: number;
  fundingDisbursedNgn: number | null;
  evidenceRef: string | null;
}): CorridorMilestoneView {
  return {
    milestoneId: m.milestoneId,
    corridorId: m.corridorId,
    title: m.title,
    plannedDate: m.plannedDate,
    actualDate: m.actualDate ?? null,
    status: m.status,
    pctComplete: m.pctComplete,
    fundingDisbursedNgn: m.fundingDisbursedNgn ?? null,
    evidenceRef: m.evidenceRef ?? null,
  };
}

function aggregate(milestones: CorridorMilestoneView[], corridorId: string) {
  const count = milestones.length;
  const totalDisbursed = milestones.reduce(
    (s, m) => s + (m.fundingDisbursedNgn ?? 0),
    0,
  );
  const totalPlanned = CORRIDOR_PLANNED_NGN[corridorId] ?? 0;
  return {
    milestoneCount: count,
    aggregatePct:
      count === 0
        ? 0
        : Math.round(
            (milestones.reduce((s, m) => s + m.pctComplete, 0) / count) * 10,
          ) / 10,
    done: milestones.filter((m) => m.status === "done").length,
    inProgress: milestones.filter((m) => m.status === "in_progress").length,
    delayed: milestones.filter((m) => m.status === "delayed").length,
    planned: milestones.filter((m) => m.status === "planned").length,
    totalDisbursedNgn: totalDisbursed,
    totalPlannedNgn: totalPlanned,
    disbursedVsPlanned:
      totalPlanned === 0
        ? 0
        : Math.round((totalDisbursed / totalPlanned) * 1000) / 1000,
  };
}

export const corridorsRouter = createRouter({
  /** Milestone timeline + aggregate progress. */
  progress: publicQuery
    .input(corridorProgressInput)
    .query(async ({ ctx, input }) => {
      const rows = await milestonesForCorridor(input.corridor_id);
      const milestones = rows.map(toView);
      return envelope(
        corridorProgressOutput.parse({
          corridorId: input.corridor_id,
          milestones,
          aggregate: aggregate(milestones, input.corridor_id),
        }),
        ctx,
      );
    }),

  /** Schedule (days slip/overdue) + funding variance per milestone. */
  variance: publicQuery
    .input(corridorProgressInput)
    .query(async ({ ctx, input }) => {
      const rows = await milestonesForCorridor(input.corridor_id);
      const milestones = rows.map(toView);
      const plannedTotal = CORRIDOR_PLANNED_NGN[input.corridor_id] ?? 0;
      const variances = milestones.map((m) =>
        computeMilestoneVariance(m, plannedTotal, milestones.length),
      );
      return envelope(
        corridorVarianceOutput.parse({
          corridorId: input.corridor_id,
          variances,
          totals: {
            maxScheduleSlipDays: variances.reduce(
              (mx, v) => Math.max(mx, v.scheduleVarianceDays ?? 0, v.daysOverdue),
              0,
            ),
            milestonesOverdue: variances.filter((v) => v.daysOverdue > 0).length,
            totalFundingVarianceNgn: variances.reduce(
              (s, v) => s + (v.fundingVarianceNgn ?? 0),
              0,
            ),
          },
        }),
        ctx,
      );
    }),

  /** Corridor ids present in the store (nav aid). */
  list: publicQuery.query(async ({ ctx }) => {
    return envelope({ corridors: await listCorridorIds() }, ctx);
  }),
});
