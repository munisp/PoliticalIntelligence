import { z } from "zod";
import { ADMIN_LEVELS } from "@contracts/entities";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { assertJurisdictionRead, accessibleJurisdictionIds, resolveReadScope } from "./utils/rbac";
import { envelope, apiError } from "./utils/envelope";
import {
  adminUnitTree,
  findJurisdiction,
  latestMetricsForJurisdiction,
  listJurisdictions,
} from "./queries/jurisdictions";
import {
  activeProgramsForJurisdiction,
  budgetSummaryForJurisdiction,
  latestMetricsPreferringLive,
  loadCanonicalBatch,
  officialsForJurisdiction,
} from "./queries/canonical";
import { audit } from "./utils/envelope";
import { evidenceByIds, opportunityRankings } from "./queries/opportunities";
import { dataSourcesByIds } from "./queries/sources";

/* ------------------------------------------------------------------ */
/* Loader (ingestion -> DB) — docs/LOADER.md                            */
/* ------------------------------------------------------------------ */

const provenanceInput = z.object({
  origin: z.enum(["live", "derived", "seed"]),
  source_id: z.string().nullish(),
  url: z.string().nullish(),
  fetched_at: z.union([z.string(), z.date()]).nullish(),
});

const canonicalRecord = z.object({
  data: z.record(z.string(), z.unknown()),
  provenance: provenanceInput,
});

/** Zod-validated canonical batches (matches ingestion CanonicalRecord). */
const loadCanonicalInput = z.object({
  jurisdiction_id: z.string().min(1).optional(),
  sector_metrics: z.array(canonicalRecord).max(500).optional(),
  facilities: z.array(canonicalRecord).max(500).optional(),
  procurement_records: z.array(canonicalRecord).max(500).optional(),
  data_sources: z.array(canonicalRecord).max(500).optional(),
  budgets: z.array(canonicalRecord).max(500).optional(),
  policy_documents: z.array(canonicalRecord).max(500).optional(),
});

const pagination = {
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(25),
};

const METRIC_TO_SCORE_KEY: Record<string, string> = {
  unemployment: "labor",
  literacy: "skills",
  sme_density: "enterprise",
  school_count: "infrastructure",
  procurement_volume: "procurement",
};

export const jurisdictionsRouter = createRouter({
  // ABAC-scoped read (SR-10/SEC-3): non-global actors see only their
  // assigned jurisdictions; executive/platform_admin see all.
  list: publicQuery
    .input(
      z.object({
        country_code: z.string().length(2).optional(),
        admin_level: z.enum(ADMIN_LEVELS).optional(),
        ...pagination,
      }),
    )
    .query(async ({ ctx, input }) => {
      const scope = await resolveReadScope(ctx);
      const page = await listJurisdictions({
        countryCode: input.country_code,
        adminLevel: input.admin_level,
        jurisdictionIds: scope.jurisdictionIds,
        cursor: input.cursor,
        limit: input.limit,
      });
      return envelope(page, ctx);
    }),

  /** The actor's accessible jurisdiction set (grants or "all"). */
  accessible: authedQuery.query(async ({ ctx }) => {
    const ids = await accessibleJurisdictionIds(ctx);
    if (ids === null) {
      return envelope({ scope: "all" as const, jurisdiction_ids: null }, ctx);
    }
    const { jurisdictionsForUser } = await import("./queries/users");
    const grants = await jurisdictionsForUser(ctx.user.id);
    return envelope(
      {
        scope: "assigned" as const,
        jurisdiction_ids: ids,
        grants: grants.map((g) => ({
          jurisdiction_id: g.jurisdictionId,
          access_level: g.accessLevel,
        })),
      },
      ctx,
    );
  }),

  get: publicQuery
    .input(z.object({ jurisdiction_id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertJurisdictionRead(ctx, input.jurisdiction_id);
      const jur = await findJurisdiction(input.jurisdiction_id);
      if (!jur)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "JURISDICTION_NOT_FOUND",
          message: `Jurisdiction ${input.jurisdiction_id} not found`,
        });
      return envelope(jur, ctx);
    }),

  profile: publicQuery
    .input(
      z.object({
        jurisdiction_id: z.string().min(1),
        /** ISO date; metrics with period <= profile year are included. */
        profile_date: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertJurisdictionRead(ctx, input.jurisdiction_id);
      const jur = await findJurisdiction(input.jurisdiction_id);
      if (!jur)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "JURISDICTION_NOT_FOUND",
          message: `Jurisdiction ${input.jurisdiction_id} not found`,
        });
      const periodTo = input.profile_date?.slice(0, 4);
      // Read path prefers live > derived > seed per metric key
      // (feat-data-loader); response shape unchanged.
      const latest = await latestMetricsPreferringLive(input.jurisdiction_id, {
        periodTo,
      });
      const metrics = await latestMetricsForJurisdiction(input.jurisdiction_id, {
        periodTo,
      });
      const scores: Record<
        string,
        { value: number; confidence: number; metric_key: string }
      > = {};
      for (const m of latest) {
        const key = METRIC_TO_SCORE_KEY[m.metricKey] ?? m.metricKey;
        scores[key] = {
          value: m.value,
          confidence: m.confidence,
          metric_key: m.metricKey,
        };
      }

      // Provenance: data sources behind the metrics + evidence cited by the
      // top-ranked opportunities in this jurisdiction.
      const sourceIds = [
        ...new Set(latest.map((m) => m.sourceId).filter((s): s is string => !!s)),
      ];
      const [dataSourcesUsed, topOpps, budgetSummary, keyOfficials, activePrograms] =
        await Promise.all([
          dataSourcesByIds(sourceIds),
          opportunityRankings({ jurisdictionId: input.jurisdiction_id, limit: 3 }),
          budgetSummaryForJurisdiction(input.jurisdiction_id),
          officialsForJurisdiction(input.jurisdiction_id),
          activeProgramsForJurisdiction(input.jurisdiction_id),
        ]);
      const oppEvidenceIds = [
        ...new Set(
          topOpps.items.flatMap((o) =>
            Array.isArray(o.evidenceRefs) ? (o.evidenceRefs as string[]) : [],
          ),
        ),
      ];
      const evidenceSources = await evidenceByIds(oppEvidenceIds);

      return envelope(
        {
          jurisdiction: jur,
          summary: {
            name: jur.name,
            admin_level: jur.adminLevel,
            country_code: jur.countryCode,
            headline_target: "250,000 new jobs by 2027",
            metrics_covered: latest.length,
          },
          scores,
          // Additive provenance per metric (feat-ingestion).
          metrics: metrics.map((m) => ({
            ...m,
            provenance: {
              origin: m.origin,
              source_url: m.sourceUrl,
              fetched_at: m.fetchedAt,
            },
          })),
          evidence_sources: evidenceSources,
          data_sources: dataSourcesUsed,
          // Additive canonical-model extensions (feat-data-loader).
          budget_summary: budgetSummary,
          key_officials: keyOfficials,
          active_programs: activePrograms,
        },
        ctx,
      );
    }),

  geoUnits: publicQuery
    .input(z.object({ jurisdiction_id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await assertJurisdictionRead(ctx, input.jurisdiction_id);
      const tree = await adminUnitTree(input.jurisdiction_id);
      return envelope(tree, ctx);
    }),

  /**
   * Machine-to-machine loader endpoint (docs/LOADER.md). The ingestion
   * service POSTs zod-validated canonical batches (<= 500 records per
   * entity per call) authenticated by the shared `x-loader-key` header;
   * every batch is recorded in the audit log. Per-entity inserted/updated
   * counts are returned; per-record errors are reported, never raised.
   */
  loadCanonical: publicQuery
    .input(loadCanonicalInput)
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
      const total =
        (input.sector_metrics?.length ?? 0) +
        (input.facilities?.length ?? 0) +
        (input.procurement_records?.length ?? 0) +
        (input.data_sources?.length ?? 0) +
        (input.budgets?.length ?? 0) +
        (input.policy_documents?.length ?? 0);
      if (total === 0) {
        throw apiError(ctx, {
          http: "BAD_REQUEST",
          code: "EMPTY_BATCH",
          message: "Batch contains no records",
          retryable: false,
        });
      }
      const counts = await loadCanonicalBatch(input);
      audit(ctx, "loader.canonical.batch", {
        type: "data_loader",
        id: input.jurisdiction_id ?? "multi",
        scopes: ["loader:write"],
        payload: { records: total, counts },
      });
      return envelope(
        { jurisdiction_id: input.jurisdiction_id ?? null, records: total, counts },
        ctx,
      );
    }),
});
