import { z } from "zod";
import { ADMIN_LEVELS } from "@contracts/entities";
import { createRouter, publicQuery } from "./middleware";
import { envelope, apiError } from "./utils/envelope";
import {
  adminUnitTree,
  findJurisdiction,
  latestMetricsForJurisdiction,
  listJurisdictions,
} from "./queries/jurisdictions";
import { evidenceByIds, opportunityRankings } from "./queries/opportunities";
import { dataSourcesByIds } from "./queries/sources";

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
  list: publicQuery
    .input(
      z.object({
        country_code: z.string().length(2).optional(),
        admin_level: z.enum(ADMIN_LEVELS).optional(),
        ...pagination,
      }),
    )
    .query(async ({ ctx, input }) => {
      const page = await listJurisdictions({
        countryCode: input.country_code,
        adminLevel: input.admin_level,
        cursor: input.cursor,
        limit: input.limit,
      });
      return envelope(page, ctx);
    }),

  get: publicQuery
    .input(z.object({ jurisdiction_id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
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
      const jur = await findJurisdiction(input.jurisdiction_id);
      if (!jur)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "JURISDICTION_NOT_FOUND",
          message: `Jurisdiction ${input.jurisdiction_id} not found`,
        });
      const periodTo = input.profile_date?.slice(0, 4);
      const metrics = await latestMetricsForJurisdiction(input.jurisdiction_id, {
        periodTo,
      });

      // Composite scores from latest value per metric key.
      const latestByKey = new Map<string, (typeof metrics)[number]>();
      for (const m of metrics) latestByKey.set(m.metricKey, m);
      const latest = [...latestByKey.values()];
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
      const [dataSourcesUsed, topOpps] = await Promise.all([
        dataSourcesByIds(sourceIds),
        opportunityRankings({ jurisdictionId: input.jurisdiction_id, limit: 3 }),
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
          metrics,
          evidence_sources: evidenceSources,
          data_sources: dataSourcesUsed,
        },
        ctx,
      );
    }),

  geoUnits: publicQuery
    .input(z.object({ jurisdiction_id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const tree = await adminUnitTree(input.jurisdiction_id);
      return envelope(tree, ctx);
    }),
});
