import { z } from "zod";
import { SOURCE_HEALTH, REVIEW_TASK_TYPES, JOB_STATUSES } from "@contracts/entities";
import { createRouter, authedQuery } from "./middleware";
import { envelope, apiError, audit } from "./utils/envelope";
import { requireRole } from "./utils/rbac";
import {
  findDataSource,
  listDataSources,
  listPipelineRuns,
  updateDataSource,
} from "./queries/sources";
import { listReviewTasks, findReviewTask, updateReviewTask } from "./queries/admin";

const steward = authedQuery.use(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw apiError(ctx, {
      http: "UNAUTHORIZED",
      code: "UNAUTHENTICATED",
      message: "Authentication required",
    });
  }
  requireRole(ctx as typeof ctx & { user: NonNullable<typeof ctx.user> }, [
    "data_steward",
  ]);
  return next();
});

export const adminRouter = createRouter({
  dataSources: steward
    .input(
      z.object({
        health: z.enum(SOURCE_HEALTH).optional(),
        category: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) =>
      envelope(
        await listDataSources({ health: input.health, category: input.category }),
        ctx,
      ),
    ),

  updateDataSource: steward
    .input(
      z.object({
        source_id: z.string().min(1),
        health: z.enum(SOURCE_HEALTH).optional(),
        refresh_cadence: z.string().optional(),
        freshness_days: z.number().int().min(0).optional(),
        contract_compliance: z
          .object({
            schema_ok: z.boolean(),
            sla_ok: z.boolean(),
            license_ok: z.boolean(),
            notes: z.string().optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const source = await findDataSource(input.source_id);
      if (!source)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "SOURCE_NOT_FOUND",
          message: `Data source ${input.source_id} not found`,
        });
      await updateDataSource(input.source_id, {
        ...(input.health ? { health: input.health } : {}),
        ...(input.refresh_cadence ? { refreshCadence: input.refresh_cadence } : {}),
        ...(input.freshness_days !== undefined
          ? { freshnessDays: input.freshness_days, lastRefresh: new Date() }
          : {}),
        ...(input.contract_compliance
          ? { contractCompliance: input.contract_compliance }
          : {}),
      });
      audit(ctx, "admin.data_source.updated", {
        type: "data_source",
        id: input.source_id,
        scopes: ["admin:sources"],
        payload: input,
      });
      return envelope(await findDataSource(input.source_id), ctx);
    }),

  pipelineRuns: steward
    .input(
      z.object({
        source_id: z.string().optional(),
        status: z.enum(JOB_STATUSES).optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) =>
      envelope(
        await listPipelineRuns({
          sourceId: input.source_id,
          status: input.status,
          limit: input.limit,
        }),
        ctx,
      ),
    ),

  /** Review-queue triage (spec §27 human-in-the-loop). */
  reviewTasks: steward
    .input(
      z.object({
        type: z.enum(REVIEW_TASK_TYPES).optional(),
        status: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) =>
      envelope(
        await listReviewTasks({
          type: input.type,
          status: input.status,
          limit: input.limit,
        }),
        ctx,
      ),
    ),

  triageReviewTask: steward
    .input(
      z.object({
        task_id: z.string().min(1),
        status: z.enum(["in_progress", "resolved", "dismissed"]),
        note: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const task = await findReviewTask(input.task_id);
      if (!task)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "TASK_NOT_FOUND",
          message: `Review task ${input.task_id} not found`,
        });
      await updateReviewTask(input.task_id, {
        status: input.status,
        payload: {
          ...(typeof task.payload === "object" && task.payload !== null
            ? (task.payload as Record<string, unknown>)
            : {}),
          triage_note: input.note ?? null,
          triaged_by: ctx.user?.id ?? null,
        },
      });
      audit(ctx, "admin.review_task.triaged", {
        type: "review_task",
        id: input.task_id,
        scopes: ["admin:triage"],
        payload: { status: input.status },
      });
      return envelope(await findReviewTask(input.task_id), ctx);
    }),

  /** Source contract compliance overview (Data Source Health console). */
  contractsCompliance: steward.query(async ({ ctx }) => {
    const rows = await listDataSources({});
    return envelope(
      rows.map((s) => ({
        source_id: s.sourceId,
        name: s.name,
        health: s.health,
        freshness_days: s.freshnessDays,
        contract_compliance: s.contractCompliance,
        compliant:
          (s.contractCompliance as { schema_ok?: boolean; sla_ok?: boolean; license_ok?: boolean } | null)
            ? Boolean(
                (s.contractCompliance as Record<string, boolean>).schema_ok &&
                  (s.contractCompliance as Record<string, boolean>).sla_ok &&
                  (s.contractCompliance as Record<string, boolean>).license_ok,
              )
            : false,
      })),
      ctx,
    );
  }),
});
