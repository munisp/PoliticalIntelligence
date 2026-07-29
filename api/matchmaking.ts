import {
  ReadinessInput,
  SuppliersInput,
  computeReadiness,
  proximityScore,
  registrationAgeScore,
  sectorMatchScore,
  sizeClassScore,
} from "@contracts/matchmaking";
import { createRouter, publicQuery } from "./middleware";
import { envelope, apiError } from "./utils/envelope";
import { activeRegistrations, findRegistration } from "./queries/matchmaking";
import { findOpportunity } from "./queries/opportunities";

/**
 * I8 — Procurement match: rank registered suppliers (CAC registry) against
 * an opportunity with a deterministic readiness score. Public read — the
 * registry and opportunity catalogue are public-tier datasets.
 */

function breakdownFor(
  reg: {
    registeredAt: string | null;
    name: string;
    jurisdictionId: string;
    lga: string | null;
    entityType: string | null;
  },
  opp: { jurisdictionId: string; sectorCode: string } | null,
) {
  return computeReadiness({
    registration_age: registrationAgeScore(reg.registeredAt),
    sector_match: sectorMatchScore(opp?.sectorCode ?? null, reg.name),
    lga_proximity: proximityScore(
      opp?.jurisdictionId ?? null,
      null,
      reg.jurisdictionId,
      reg.lga,
    ),
    size_class: sizeClassScore(reg.entityType),
  });
}

export const matchmakingRouter = createRouter({
  /** Top suppliers for an opportunity, ranked by readiness score. */
  suppliers: publicQuery
    .input(SuppliersInput)
    .query(async ({ ctx, input }) => {
      const opp = await findOpportunity(input.opportunity_id);
      if (!opp)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "OPPORTUNITY_NOT_FOUND",
          message: `Opportunity ${input.opportunity_id} not found`,
        });
      const regs = await activeRegistrations();
      const ranked = regs
        .map((r) => ({ r, b: breakdownFor(r, opp) }))
        .sort(
          (a, b) =>
            b.b.readiness_score - a.b.readiness_score ||
            a.r.registrationId.localeCompare(b.r.registrationId),
        )
        .slice(0, input.limit);
      return envelope(
        {
          opportunity_id: input.opportunity_id,
          sector_code: opp.sectorCode,
          suppliers: ranked.map(({ r, b }) => ({
            registration_id: r.registrationId,
            name: r.name,
            rc_number: r.rcNumber,
            lga: r.lga,
            entity_type: r.entityType,
            registered_at: r.registeredAt,
            origin: r.origin,
            readiness_score: b.readiness_score,
            breakdown: {
              registration_age: b.registration_age,
              sector_match: b.sector_match,
              lga_proximity: b.lga_proximity,
              size_class: b.size_class,
            },
          })),
        },
        ctx,
      );
    }),

  /** Readiness breakdown for one registration (optional opportunity ctx). */
  readiness: publicQuery
    .input(ReadinessInput)
    .query(async ({ ctx, input }) => {
      const reg = await findRegistration(input.registration_id);
      if (!reg)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "REGISTRATION_NOT_FOUND",
          message: `Registration ${input.registration_id} not found`,
        });
      const opp = input.opportunity_id
        ? await findOpportunity(input.opportunity_id)
        : null;
      const b = breakdownFor(reg, opp ?? null);
      return envelope(
        {
          registration_id: reg.registrationId,
          name: reg.name,
          ...b,
        },
        ctx,
      );
    }),
});
