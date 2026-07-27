import { z } from "zod";
import { API_VERSION } from "@contracts/entities";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { envelope, apiError } from "./utils/envelope";
import { resolveRole } from "./utils/rbac";
import { listJobsForActor } from "./queries/admin";
import { listAuditEvents } from "./queries/audit";
import { freshnessSummary } from "./queries/sources";

export const opsRouter = createRouter({
  /** Liveness/readiness probe. */
  health: publicQuery.query(({ ctx }) =>
    envelope(
      {
        status: "ok",
        api_version: API_VERSION,
        services: {
          simulation: process.env.SIMULATION_BASE_URL ?? "http://localhost:8100",
          ai: process.env.AI_BASE_URL ?? "http://localhost:8200",
        },
        ts: new Date(),
      },
      ctx,
    ),
  ),

  /** Background jobs for the current actor (topbar Jobs indicator). */
  jobsList: authedQuery
    .input(
      z.object({
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await listJobsForActor(ctx.user.id, input.limit);
      return envelope(
        rows.map((j) => ({
          job_id: j.jobId,
          type: j.type,
          status: j.status,
          progress: j.progress,
          error: j.error,
          created_at: j.createdAt,
          finished_at: j.finishedAt,
        })),
        ctx,
      );
    }),

  /** Append-only audit log viewer (admin/steward). Cursor = eventId. */
  auditLog: authedQuery
    .input(
      z.object({
        entity_type: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const role = resolveRole(ctx.user);
      if (role !== "platform_admin" && role !== "data_steward" && ctx.user.role !== "admin")
        throw apiError(ctx, {
          http: "FORBIDDEN",
          code: "FORBIDDEN",
          message: "Audit log requires platform_admin or data_steward role",
          details: { actual: role },
        });
      return envelope(
        await listAuditEvents({
          entityType: input.entity_type,
          cursor: input.cursor ? Number(input.cursor) : undefined,
          limit: input.limit,
        }),
        ctx,
      );
    }),

  /** Topbar freshness chip: latest data as-of date + aggregate status. */
  freshnessSummary: publicQuery.query(async ({ ctx }) => {
    const summary = await freshnessSummary();
    return envelope(
      {
        ...summary,
        label: summary.asOf
          ? `Data as of ${summary.asOf.toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}`
          : "No data sources registered",
      },
      ctx,
    );
  }),

  /**
   * Ingestion service reports processed-record counts here so the
   * ingestion_records_total metric has data on every pipeline completion.
   */
  recordIngestion: authedQuery
    .input(
      z.object({
        source_id: z.string().min(1),
        records: z.number().int().min(0),
        pipeline_id: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const role = resolveRole(ctx.user);
      if (role !== "data_steward" && role !== "platform_admin" && ctx.user.role !== "admin")
        throw apiError(ctx, {
          http: "FORBIDDEN",
          code: "FORBIDDEN",
          message: "Recording ingestion requires data_steward role",
          details: { actual: role },
        });
      const { ingestionRecordsTotal } = await import("./utils/metrics");
      ingestionRecordsTotal.inc({ source: input.source_id }, input.records);
      return envelope({ source_id: input.source_id, recorded: input.records }, ctx);
    }),
});
