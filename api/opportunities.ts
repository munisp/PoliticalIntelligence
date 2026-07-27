import { z } from "zod";
import { nanoid } from "nanoid";
import { confidenceTier } from "@contracts/entities";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { envelope, apiError, audit, requestMeta } from "./utils/envelope";
import { requireRole, assertJurisdictionAccess } from "./utils/rbac";
import {
  evidenceByIds,
  findOpportunitiesByIds,
  findOpportunity,
  interventionsForOpportunity,
  opportunityRankings,
} from "./queries/opportunities";
import { findJob, findJobByIdempotencyKey, insertJob } from "./queries/admin";
import { enqueuePersistedJob } from "./runner";

export const opportunitiesRouter = createRouter({
  rankings: publicQuery
    .input(
      z.object({
        jurisdiction_id: z.string().optional(),
        sector_code: z.string().optional(),
        geography: z.string().optional(), // admin-unit scope (reserved; maps to jurisdiction filter)
        horizon_max_months: z.number().int().positive().optional(),
        confidence_floor: z.number().min(0).max(1).optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const jur = input.jurisdiction_id ?? input.geography;
      // ABAC: authenticated actors are restricted to assigned jurisdictions.
      if (ctx.user && jur) {
        await assertJurisdictionAccess(ctx as never, jur, "read");
      }
      const page = await opportunityRankings({
        jurisdictionId: input.jurisdiction_id ?? input.geography,
        sectorCode: input.sector_code,
        horizonMaxMonths: input.horizon_max_months,
        confidenceFloor: input.confidence_floor,
        cursor: input.cursor,
        limit: input.limit,
      });
      return envelope(
        {
          ...page,
          items: page.items.map((o) => ({
            ...o,
            confidence_tier: confidenceTier(o.confidence),
            // Additive provenance label (feat-ingestion): live/derived/seed.
            provenance: {
              origin: o.origin,
              source_url: o.sourceUrl,
              fetched_at: o.fetchedAt,
            },
          })),
        },
        ctx,
      );
    }),

  get: publicQuery
    .input(z.object({ opportunity_id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const opp = await findOpportunity(input.opportunity_id);
      if (!opp)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "OPPORTUNITY_NOT_FOUND",
          message: `Opportunity ${input.opportunity_id} not found`,
        });
      const evidenceIds = Array.isArray(opp.evidenceRefs)
        ? (opp.evidenceRefs as string[])
        : [];
      const [evidence, interventions] = await Promise.all([
        evidenceByIds(evidenceIds),
        interventionsForOpportunity(opp.opportunityId),
      ]);
      return envelope(
        {
          ...opp,
          confidence_tier: confidenceTier(opp.confidence),
          evidence_bundle: evidence,
          interventions,
        },
        ctx,
      );
    }),

  compare: publicQuery
    .input(
      z.object({
        opportunity_ids: z.array(z.string().min(1)).min(2).max(6),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await findOpportunitiesByIds(input.opportunity_ids);
      if (rows.length !== input.opportunity_ids.length)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "OPPORTUNITY_NOT_FOUND",
          message: "One or more opportunities not found",
          details: {
            found: rows.map((r) => r.opportunityId),
            requested: input.opportunity_ids,
          },
        });
      const allEvidenceIds = [
        ...new Set(
          rows.flatMap((r) =>
            Array.isArray(r.evidenceRefs) ? (r.evidenceRefs as string[]) : [],
          ),
        ),
      ];
      const evidence = await evidenceByIds(allEvidenceIds);
      return envelope(
        {
          opportunities: rows.map((o) => ({
            ...o,
            confidence_tier: confidenceTier(o.confidence),
          })),
          evidence_bundle: evidence,
          comparison: {
            by_score: [...rows]
              .sort((a, b) => b.score - a.score)
              .map((r) => r.opportunityId),
            by_jobs_expected: [...rows]
              .sort(
                (a, b) =>
                  (b.estimatedJobsMax ?? 0) - (a.estimatedJobsMax ?? 0),
              )
              .map((r) => r.opportunityId),
          },
        },
        ctx,
      );
    }),

  /**
   * Async recommendation generation (202-style).
   * Idempotent on `idempotency_key`: re-submitting returns the same job.
   */
  generate: authedQuery
    .input(
      z.object({
        opportunity_id: z.string().min(1),
        idempotency_key: z.string().min(8).max(128),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, ["policy_analyst"]);
      const existing = await findJobByIdempotencyKey(input.idempotency_key);
      if (existing) {
        return envelope(
          { job_id: existing.jobId, status: existing.status, deduplicated: true },
          ctx,
        );
      }
      const opp = await findOpportunity(input.opportunity_id);
      if (!opp)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "OPPORTUNITY_NOT_FOUND",
          message: `Opportunity ${input.opportunity_id} not found`,
        });
      await assertJurisdictionAccess(ctx, opp.jurisdictionId, "write");
      const jobId = `job:${nanoid(16)}`;
      await insertJob({
        jobId,
        type: "opportunities.generate",
        status: "queued",
        progress: 0,
        input: {
          opportunity_id: input.opportunity_id,
          actor_id: ctx.user.id,
          request_id: requestMeta(ctx).request_id,
        },
        idempotencyKey: input.idempotency_key,
        actorId: ctx.user.id,
      });
      await enqueuePersistedJob(jobId);
      audit(ctx, "opportunities.generate.requested", {
        type: "job",
        id: jobId,
        scopes: ["opportunities:generate"],
        payload: { opportunity_id: input.opportunity_id },
      });
      return envelope({ job_id: jobId, status: "queued" as const }, ctx);
    }),

  generateStatus: authedQuery
    .input(z.object({ job_id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const job = await findJob(input.job_id);
      if (!job)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "JOB_NOT_FOUND",
          message: `Job ${input.job_id} not found`,
        });
      return envelope(
        {
          job_id: job.jobId,
          type: job.type,
          status: job.status,
          progress: job.progress,
          result: job.result,
          error: job.error,
          created_at: job.createdAt,
          finished_at: job.finishedAt,
        },
        ctx,
      );
    }),
});
