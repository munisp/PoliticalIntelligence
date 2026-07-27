import { z } from "zod";
import { nanoid } from "nanoid";
import { SIMULATION_ENGINES, type BandPoint, type SimulationResultSummary } from "@contracts/entities";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { envelope, apiError, audit } from "./utils/envelope";
import { requireRole } from "./utils/rbac";
import {
  findAssumptionSet,
  findScenario,
  findSimulationRun,
  findSimulationRunsByIds,
  insertScenario,
  insertSimulationRun,
  listArtifacts,
  listScenarios,
  runsForScenario,
} from "./queries/scenarios";
import { insertJob } from "./queries/admin";
import { enqueuePersistedJob } from "./runner";

export const scenariosRouter = createRouter({
  create: authedQuery
    .input(
      z.object({
        scenario_id: z.string().min(1).optional(),
        jurisdiction_id: z.string().min(1),
        name: z.string().min(3),
        description: z.string().optional(),
        intervention_ids: z.array(z.string()).default([]),
        assumptions_set_id: z.string().optional(),
        model_plan: z
          .array(z.object({ engine: z.enum(SIMULATION_ENGINES), params: z.record(z.string(), z.unknown()).optional() }))
          .default([{ engine: "forecast" }]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, ["simulation_specialist", "policy_analyst"]);
      if (input.assumptions_set_id) {
        const set = await findAssumptionSet(input.assumptions_set_id);
        if (!set)
          throw apiError(ctx, {
            http: "BAD_REQUEST",
            code: "ASSUMPTIONS_NOT_FOUND",
            message: `Assumption set ${input.assumptions_set_id} not found`,
          });
      }
      const scenarioId = input.scenario_id ?? `scn:${nanoid(8)}`;
      await insertScenario({
        scenarioId,
        jurisdictionId: input.jurisdiction_id,
        name: input.name,
        description: input.description ?? null,
        interventionIds: input.intervention_ids,
        assumptionsSetId: input.assumptions_set_id ?? null,
        modelPlan: input.model_plan,
        status: "draft",
        version: 1,
        createdBy: ctx.user.id,
      });
      audit(ctx, "scenarios.created", {
        type: "scenario",
        id: scenarioId,
        scopes: ["scenarios:write"],
      });
      const scenario = await findScenario(scenarioId);
      return envelope(scenario, ctx);
    }),

  list: publicQuery
    .input(
      z.object({
        jurisdiction_id: z.string().optional(),
        status: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) =>
      envelope(
        await listScenarios({
          jurisdictionId: input.jurisdiction_id,
          status: input.status,
          cursor: input.cursor,
          limit: input.limit,
        }),
        ctx,
      ),
    ),

  get: publicQuery
    .input(z.object({ scenario_id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const scenario = await findScenario(input.scenario_id);
      if (!scenario)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "SCENARIO_NOT_FOUND",
          message: `Scenario ${input.scenario_id} not found`,
        });
      const [runs, assumptions] = await Promise.all([
        runsForScenario(input.scenario_id),
        scenario.assumptionsSetId
          ? findAssumptionSet(scenario.assumptionsSetId)
          : Promise.resolve(null),
      ]);
      return envelope({ ...scenario, runs, assumptions }, ctx);
    }),

  /** Async run submission → simulation bridge (202-style job). */
  addRun: authedQuery
    .input(
      z.object({
        scenario_id: z.string().min(1),
        engine: z.enum(SIMULATION_ENGINES),
        seed: z.number().int().default(42),
        execution_profile: z.record(z.string(), z.unknown()).optional(),
        idempotency_key: z.string().min(8).max(128).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, ["simulation_specialist"]);
      const scenario = await findScenario(input.scenario_id);
      if (!scenario)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "SCENARIO_NOT_FOUND",
          message: `Scenario ${input.scenario_id} not found`,
        });
      const simulationRunId = `sim:${nanoid(10)}`;
      await insertSimulationRun({
        simulationRunId,
        scenarioId: input.scenario_id,
        engine: input.engine,
        executionProfile: input.execution_profile ?? {},
        modelVersions: {},
        status: "queued",
        progress: 0,
        seed: input.seed,
        startedAt: new Date(),
      });
      const jobId = `job:${nanoid(16)}`;
      await insertJob({
        jobId,
        type: "simulations.run",
        status: "queued",
        progress: 0,
        input: { simulation_run_id: simulationRunId, actor_id: ctx.user.id },
        idempotencyKey: input.idempotency_key ?? null,
        actorId: ctx.user.id,
      });
      await enqueuePersistedJob(jobId);
      audit(ctx, "scenarios.run.requested", {
        type: "simulation_run",
        id: simulationRunId,
        scopes: ["scenarios:run"],
        payload: { scenario_id: input.scenario_id, engine: input.engine },
      });
      return envelope(
        { simulation_run_id: simulationRunId, job_id: jobId, status: "queued" as const },
        ctx,
      );
    }),

  runStatus: publicQuery
    .input(z.object({ simulation_run_id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const run = await findSimulationRun(input.simulation_run_id);
      if (!run)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "RUN_NOT_FOUND",
          message: `Simulation run ${input.simulation_run_id} not found`,
        });
      return envelope(
        {
          simulation_run_id: run.simulationRunId,
          scenario_id: run.scenarioId,
          engine: run.engine,
          status: run.status,
          progress: run.progress,
          started_at: run.startedAt,
          finished_at: run.finishedAt,
        },
        ctx,
      );
    }),

  /** Uncertainty-band series for UncertaintyBandChart. */
  runResults: publicQuery
    .input(z.object({ simulation_run_id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const run = await findSimulationRun(input.simulation_run_id);
      if (!run)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "RUN_NOT_FOUND",
          message: `Simulation run ${input.simulation_run_id} not found`,
        });
      if (run.status !== "succeeded" || !run.resultSummary)
        throw apiError(ctx, {
          http: "CONFLICT",
          code: "RUN_NOT_COMPLETE",
          message: `Run ${input.simulation_run_id} has no results yet (status: ${run.status})`,
          retryable: true,
        });
      const summary = run.resultSummary as SimulationResultSummary;
      return envelope(
        {
          simulation_run_id: run.simulationRunId,
          engine: run.engine,
          metric: summary.metric,
          unit: summary.unit,
          band: "80%",
          series: summary.series,
          extras: summary.extras,
          artifact_uri: run.artifactUri,
        },
        ctx,
      );
    }),

  /** Aligned series + divergence stats for compare mode. */
  compareRuns: publicQuery
    .input(
      z.object({
        simulation_run_ids: z.array(z.string().min(1)).min(2).max(6),
      }),
    )
    .query(async ({ ctx, input }) => {
      const runs = await findSimulationRunsByIds(input.simulation_run_ids);
      const ready = runs.filter((r) => r.status === "succeeded" && r.resultSummary);
      if (ready.length < 2)
        throw apiError(ctx, {
          http: "CONFLICT",
          code: "RUNS_NOT_COMPLETE",
          message: "At least two succeeded runs are required to compare",
          retryable: true,
          details: {
            ready: ready.map((r) => r.simulationRunId),
            requested: input.simulation_run_ids,
          },
        });
      const aligned = ready.map((r) => {
        const s = r.resultSummary as SimulationResultSummary;
        return {
          simulation_run_id: r.simulationRunId,
          engine: r.engine,
          metric: s.metric,
          unit: s.unit,
          series: s.series.map((p: BandPoint) => ({
            month: p.month,
            mean: p.mean,
            lower: p.lower,
            upper: p.upper,
          })),
        };
      });
      // Divergence: pairwise mean absolute gap over shared months.
      const divergence: { a: string; b: string; mean_abs_gap: number; max_gap_month: number }[] = [];
      for (let i = 0; i < aligned.length; i++) {
        for (let j = i + 1; j < aligned.length; j++) {
          const A = aligned[i];
          const B = aligned[j];
          const bByMonth = new Map(B.series.map((p) => [p.month, p.mean]));
          let sum = 0;
          let n = 0;
          let maxGap = 0;
          let maxMonth = 0;
          for (const p of A.series) {
            const other = bByMonth.get(p.month);
            if (other === undefined) continue;
            const gap = Math.abs(p.mean - other);
            sum += gap;
            n++;
            if (gap > maxGap) {
              maxGap = gap;
              maxMonth = p.month;
            }
          }
          divergence.push({
            a: A.simulation_run_id,
            b: B.simulation_run_id,
            mean_abs_gap: n ? Math.round(sum / n) : 0,
            max_gap_month: maxMonth,
          });
        }
      }
      return envelope({ runs: aligned, divergence }, ctx);
    }),

  listArtifacts: publicQuery
    .input(z.object({ scenario_id: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const rows = await listArtifacts(input.scenario_id);
      return envelope(
        rows.map((r) => ({
          simulation_run_id: r.simulationRunId,
          scenario_id: r.scenarioId,
          engine: r.engine,
          artifact_uri: r.artifactUri,
          finished_at: r.finishedAt,
        })),
        ctx,
      );
    }),
});
