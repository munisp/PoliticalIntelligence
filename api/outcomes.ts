import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { assertJurisdictionRead } from "./utils/rbac";
import { envelope, apiError, audit } from "./utils/envelope";
import {
  listSeriesForJurisdiction,
  observationsForSeries,
  upsertOutcomeObservations,
} from "./queries/outcomes";

/**
 * Realized-outcome store (feature G2 — docs/OUTCOMES.md).
 *
 * listSeries / getObservations power the API-side handoff to the
 * simulation service (the sim service's GET /v1/outcomes/{jur} endpoint
 * mirrors whatever a loader has pushed here; see docs/OUTCOMES.md §4).
 * upsertObservations is the machine-to-machine loader endpoint, protected
 * by the shared x-loader-key header exactly like jurisdictions.loadCanonical.
 */

const provenanceInput = z.object({
  origin: z.enum(["live", "derived", "seed"]),
  source_id: z.string().nullish(),
  url: z.string().nullish(),
  fetched_at: z.union([z.string(), z.date()]).nullish(),
});

const observationRecord = z.object({
  data: z.object({
    jurisdiction_id: z.string().min(1),
    indicator_code: z.string().min(1).max(64),
    unit: z.string().min(1).max(32),
    frequency: z.enum(["monthly", "quarterly", "annual"]),
    source: z.string().max(255).optional(),
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "period must be YYYY-MM"),
    value: z.number().finite(),
  }),
  provenance: provenanceInput,
});

export const outcomesRouter = createRouter({
  listSeries: publicQuery
    .input(z.object({ jurisdiction_id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertJurisdictionRead(ctx, input.jurisdiction_id);
      const rows = await listSeriesForJurisdiction(input.jurisdiction_id);
      return envelope({ jurisdiction_id: input.jurisdiction_id, series: rows }, ctx);
    }),

  getObservations: publicQuery
    .input(
      z.object({
        series_id: z.number().int().positive(),
        from: z.string().regex(/^\d{4}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await observationsForSeries(input.series_id, input.from, input.to);
      return envelope(
        { series_id: input.series_id, observations: rows },
        ctx,
      );
    }),

  /**
   * Machine-to-machine loader endpoint (docs/OUTCOMES.md). The ingestion
   * service POSTs zod-validated observation batches (<= 500 records)
   * authenticated by the shared `x-loader-key` header; upserts are keyed
   * (series natural key, period) so replays are idempotent.
   */
  upsertObservations: publicQuery
    .input(
      z.object({
        jurisdiction_id: z.string().min(1).optional(),
        observations: z.array(observationRecord).min(1).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const expected = process.env.LOADER_API_KEY;
      const provided = ctx.req.headers.get("x-loader-key");
      if (!expected || provided !== expected) {
        throw apiError(ctx, {
          http: "UNAUTHORIZED",
          code: "LOADER_KEY_INVALID",
          message: "Valid x-loader-key header required",
          retryable: false,
        });
      }
      const { counts, error_messages } = await upsertOutcomeObservations(
        input.observations,
      );
      audit(ctx, "loader.outcomes.batch", {
        type: "data_loader",
        id: input.jurisdiction_id ?? "multi",
        scopes: ["loader:write"],
        payload: { records: input.observations.length, counts },
      });
      return envelope(
        {
          jurisdiction_id: input.jurisdiction_id ?? null,
          records: input.observations.length,
          counts,
          error_messages,
        },
        ctx,
      );
    }),
});
