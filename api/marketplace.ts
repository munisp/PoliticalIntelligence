import { nanoid } from "nanoid";
import {
  ForkInput,
  ListInput,
  PublishInput,
  VerifyInput,
  type VerificationBadge,
} from "@contracts/marketplace";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { envelope, apiError, audit } from "./utils/envelope";
import { requireRole, assertJurisdictionAccess } from "./utils/rbac";
import {
  findPublished,
  incrementForkCount,
  insertPublished,
  listPublished,
} from "./queries/marketplace";
import {
  findScenario,
  findSimulationRun,
  insertScenario,
} from "./queries/scenarios";
import { computeReproducibilityHash } from "./utils/manifest";

/**
 * I9 — Scenario marketplace: publish reproducible simulation runs, fork them
 * into your jurisdiction, and verify their reproducibility hash.
 */

async function loadRunOrThrow(ctx: Parameters<typeof apiError>[0], runId: string) {
  const run = await findSimulationRun(runId);
  if (!run)
    throw apiError(ctx, {
      http: "NOT_FOUND",
      code: "SIMULATION_RUN_NOT_FOUND",
      message: `Simulation run ${runId} not found`,
    });
  return run;
}

export const marketplaceRouter = createRouter({
  /** Publish a run: requires a persisted manifest + reproducibility hash. */
  publish: authedQuery
    .input(PublishInput)
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, ["simulation_specialist", "policy_analyst"]);
      const run = await loadRunOrThrow(ctx, input.simulation_run_id);
      if (!run.manifest || !run.reproducibilityHash)
        throw apiError(ctx, {
          http: "CONFLICT",
          code: "RUN_NOT_REPRODUCIBLE",
          message:
            `Run ${input.simulation_run_id} has no persisted manifest / ` +
            "reproducibility hash — only reproducible runs can be published",
          details: {
            has_manifest: !!run.manifest,
            has_hash: !!run.reproducibilityHash,
          },
        });
      const publishedId = `pub:${nanoid(10)}`;
      const row = await insertPublished({
        publishedId,
        scenarioRunId: run.simulationRunId,
        publishedBy: ctx.user.id,
        title: input.title,
        summary: input.summary ?? null,
        reproducibilityHash: run.reproducibilityHash,
      });
      audit(ctx, "marketplace.scenario.published", {
        type: "published_scenario",
        id: publishedId,
        scopes: ["marketplace:publish"],
        payload: {
          simulation_run_id: run.simulationRunId,
          scenario_id: run.scenarioId,
          reproducibility_hash: run.reproducibilityHash,
        },
      });
      return envelope(row, ctx);
    }),

  /** Public catalogue. */
  list: publicQuery.input(ListInput).query(async ({ ctx, input }) => {
    const rows = await listPublished(input.limit);
    return envelope(
      rows.map((r) => ({
        published_id: r.publishedId,
        scenario_run_id: r.scenarioRunId,
        title: r.title,
        summary: r.summary,
        fork_count: r.forkCount,
        reproducibility_hash: r.reproducibilityHash,
        published_at: r.publishedAt,
      })),
      ctx,
    );
  }),

  /**
   * Fork: create a new draft scenario from the published run's source
   * scenario assumptions, then increment forkCount.
   */
  fork: authedQuery
    .input(ForkInput)
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, ["simulation_specialist", "policy_analyst"]);
      await assertJurisdictionAccess(ctx, input.jurisdiction_id, "write");
      const pub = await findPublished(input.published_id);
      if (!pub)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "PUBLISHED_SCENARIO_NOT_FOUND",
          message: `Published scenario ${input.published_id} not found`,
        });
      const run = await loadRunOrThrow(ctx, pub.scenarioRunId);
      const source = await findScenario(run.scenarioId);
      if (!source)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "SCENARIO_NOT_FOUND",
          message: `Source scenario ${run.scenarioId} not found`,
        });
      const scenarioId = `scn:${nanoid(8)}`;
      await insertScenario({
        scenarioId,
        jurisdictionId: input.jurisdiction_id,
        name: input.name ?? `${pub.title} (fork)`,
        description:
          `Forked from marketplace entry ${pub.publishedId} ` +
          `(run ${pub.scenarioRunId}, hash ${pub.reproducibilityHash ?? "n/a"}). ` +
          (source.description ?? ""),
        interventionIds: (source.interventionIds as never) ?? [],
        assumptionsSetId: source.assumptionsSetId,
        modelPlan: (source.modelPlan as never) ?? [{ engine: "forecast" }],
        status: "draft",
        version: 1,
        createdBy: ctx.user.id,
      });
      await incrementForkCount(pub.publishedId);
      audit(ctx, "marketplace.scenario.forked", {
        type: "scenario",
        id: scenarioId,
        scopes: ["marketplace:fork"],
        payload: {
          published_id: pub.publishedId,
          source_scenario_id: source.scenarioId,
          jurisdiction_id: input.jurisdiction_id,
        },
      });
      return envelope(
        { scenario_id: scenarioId, published_id: pub.publishedId },
        ctx,
      );
    }),

  /**
   * Verify: recompute sha256(manifest + result_summary) for the underlying
   * run and compare with the stored hash → badge valid|stale.
   */
  verify: publicQuery
    .input(VerifyInput)
    .query(async ({ ctx, input }) => {
      const pub = await findPublished(input.published_id);
      if (!pub)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "PUBLISHED_SCENARIO_NOT_FOUND",
          message: `Published scenario ${input.published_id} not found`,
        });
      const run = await loadRunOrThrow(ctx, pub.scenarioRunId);
      let badge: VerificationBadge = "stale";
      let recomputed: string | null = null;
      if (run.manifest && run.resultSummary) {
        recomputed = computeReproducibilityHash(
          run.manifest as never,
          run.resultSummary as never,
        );
        if (
          recomputed === run.reproducibilityHash &&
          run.reproducibilityHash === pub.reproducibilityHash
        ) {
          badge = "valid";
        }
      }
      return envelope(
        {
          published_id: pub.publishedId,
          scenario_run_id: pub.scenarioRunId,
          badge,
          published_hash: pub.reproducibilityHash,
          run_hash: run.reproducibilityHash,
          recomputed_hash: recomputed,
        },
        ctx,
      );
    }),
});
