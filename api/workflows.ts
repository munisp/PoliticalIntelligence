import { z } from "zod";
import { createRouter, authedQuery } from "./middleware";
import { envelope, apiError } from "./utils/envelope";
import { requireRole } from "./utils/rbac";
import { startIngestionWorkflow, temporalEnabled } from "./bridges/temporal";

/**
 * Durable workflow triggers (ADR-010, docs/TEMPORAL.md).
 *
 * `workflows.ingestion.runWorkflow` starts an ingestion pipeline run. With
 * TEMPORAL_URL configured it launches the Temporal
 * `IngestionPipelineWorkflow` (Go worker: services/workflows-go); otherwise
 * it degrades to the existing direct HTTP trigger against the ingestion
 * service — callers get a uniform response with `mode` telling them which
 * execution engine was used.
 */
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

export const workflowsRouter = createRouter({
  status: steward.query(async ({ ctx }) =>
    envelope(
      {
        temporal_enabled: temporalEnabled(),
        temporal_url: temporalEnabled() ? process.env.TEMPORAL_URL : null,
        task_queue: process.env.TEMPORAL_TASK_QUEUE ?? "policy-twin",
      },
      ctx,
    ),
  ),

  ingestion: createRouter({
    runWorkflow: steward
      .input(
        z.object({
          connector: z.string().min(1),
          jurisdiction: z.string().min(1),
          since: z.string().optional(),
          params: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const started = await startIngestionWorkflow(input);
        return envelope(started, ctx);
      }),
  }),
});
