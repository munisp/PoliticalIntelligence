/**
 * Onboarding router (feat-ingestion).
 *
 * INTEGRATION: mount as `onboarding: onboardingRouter` in api/router.ts
 * (owned by another agent — see docs/INGESTION.md).
 */
import { nanoid } from "nanoid";
import { z } from "zod";
import { onboardInputSchema } from "@contracts/onboarding";
import { createRouter, authedQuery, publicQuery } from "./middleware";
import { createJobRunner } from "./utils/jobs";
import { envelope, apiError, audit, requestMeta } from "./utils/envelope";
import { requireRole } from "./utils/rbac";
import { dbJobStore, findJob, findJobByIdempotencyKey, insertJob } from "./queries/admin";
import {
  jurisdictionProvenanceSummaries,
  listPackCodes,
  loadPack,
  packSummary,
  recordIngestionRun,
  upsertPack,
} from "./queries/onboarding";

const INGESTION_BASE_URL =
  process.env.INGESTION_BASE_URL ?? "http://localhost:8300";

/** Module-local runner so this router needs no edits to api/runner.ts. */
const onboardingRunner = createJobRunner(dbJobStore);

/* ------------------------------------------------------------------ */
/* Ingestion-service bridge (HTTP) with deterministic local fallback    */
/* ------------------------------------------------------------------ */

type ConnectorJob = { connector: string; job_id: string | null; error?: string };

type IngestionJobPoll = {
  status: string;
  records_in: number;
  records_out: number;
  contract?: unknown;
  loader?: {
    status?: string;
    entities?: Record<
      string,
      { records: number; inserted: number; updated: number; errors: number }
    >;
    error_messages?: string[];
  } | null;
  error?: string | null;
};

/** Poll one ingestion-service job to a terminal state (feat-data-loader). */
async function pollIngestionJob(
  jobId: string,
  timeoutMs = 120_000,
  intervalMs = 2_000,
): Promise<IngestionJobPoll> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const resp = await fetch(`${INGESTION_BASE_URL}/v1/ingest/jobs/${jobId}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) throw new Error(`ingestion job poll ${resp.status}`);
    const body = (await resp.json()) as { data: IngestionJobPoll };
    const job = body.data;
    if (job.status === "succeeded" || job.status === "failed") return job;
    if (Date.now() > deadline)
      throw new Error(`ingestion job ${jobId} timed out (${job.status})`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function callIngestionService(
  connector: string,
  jurisdictionId: string,
  params: Record<string, unknown>,
): Promise<ConnectorJob> {
  const resp = await fetch(`${INGESTION_BASE_URL}/v1/ingest/${connector}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jurisdiction: jurisdictionId, params }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) throw new Error(`ingestion service ${resp.status}`);
  const body = (await resp.json()) as { data: { job_id: string } };
  return { connector, job_id: body.data.job_id };
}

onboardingRunner.register("onboarding.onboard", async ({ input, reportProgress }) => {
  const { pack_code, actor_id } = input as {
    pack_code: string;
    actor_id: number | null;
  };
  const pack = loadPack(pack_code);
  const jurisdictionId = pack.jurisdiction.id;

  // 1. Structure from the pack is always upserted (provenance: seed — it is
  //    config-declared, not fetched).
  const upserts = await upsertPack(pack);
  await reportProgress(25);

  // 2. Try the live ingestion service; fall back to a recorded local run.
  const connectorJobs: ConnectorJob[] = [];
  let mode: "ingestion_service" | "local_fallback" = "ingestion_service";
  const requested = Object.entries(pack.connectors) as [
    string,
    Record<string, unknown>,
  ][];
  let step = 0;
  for (const [connector, cfg] of requested) {
    try {
      connectorJobs.push(await callIngestionService(connector, jurisdictionId, cfg));
    } catch (err) {
      mode = "local_fallback";
      connectorJobs.push({
        connector,
        job_id: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    step++;
    await reportProgress(25 + Math.round((60 * step) / requested.length));
  }

  // 3. Record every attempted run in ingestion_runs (audit trail — including
  //    service-unavailable fallbacks, so nothing is silently seed), then
  //    poll each accepted job to completion and persist the final status,
  //    record counts, and loader (ingestion -> DB) outcome.
  const runIds = new Map<string, string>();
  for (const cj of connectorJobs) {
    const runId = `run_${nanoid(12)}`;
    runIds.set(cj.connector, runId);
    await recordIngestionRun({
      runId,
      connector: cj.connector,
      jurisdictionId,
      status: cj.job_id ? "queued" : "failed",
      error: cj.error ?? null,
      finishedAt: cj.job_id ? undefined : new Date(),
    });
  }

  const loaderCounts: Record<
    string,
    { inserted: number; updated: number; errors: number }
  > = {};
  let step2 = 0;
  for (const cj of connectorJobs) {
    if (!cj.job_id) continue;
    try {
      const job = await pollIngestionJob(cj.job_id);
      await recordIngestionRun({
        runId: runIds.get(cj.connector)!,
        connector: cj.connector,
        jurisdictionId,
        status: job.status === "succeeded" ? "succeeded" : "failed",
        recordsIn: job.records_in,
        recordsOut: job.records_out,
        contractResults: {
          contract: job.contract ?? null,
          loader: job.loader ?? null,
        },
        error: job.error ?? null,
        finishedAt: new Date(),
      });
      for (const [entity, c] of Object.entries(job.loader?.entities ?? {})) {
        const acc = loaderCounts[entity] ?? { inserted: 0, updated: 0, errors: 0 };
        acc.inserted += c.inserted;
        acc.updated += c.updated;
        acc.errors += c.errors;
        loaderCounts[entity] = acc;
      }
    } catch (err) {
      await recordIngestionRun({
        runId: runIds.get(cj.connector)!,
        connector: cj.connector,
        jurisdictionId,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        finishedAt: new Date(),
      });
    }
    step2++;
    await reportProgress(85 + Math.round((10 * step2) / connectorJobs.length));
  }
  await reportProgress(95);

  // 4. Post-load provenance counts for this jurisdiction.
  const summaries = await jurisdictionProvenanceSummaries();
  const provenance = summaries.find(
    (s) =>
      s.jurisdiction_id === jurisdictionId ||
      s.jurisdiction_id === `jur:${jurisdictionId}`,
  ) ?? null;

  return {
    pack_code,
    jurisdiction_id: jurisdictionId,
    mode,
    connector_jobs: connectorJobs,
    upserts,
    loader_counts: loaderCounts,
    provenance,
    actor_id,
  };
});

/* ------------------------------------------------------------------ */
/* Router                                                               */
/* ------------------------------------------------------------------ */

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
    "platform_admin",
  ]);
  return next();
});

export const onboardingRouter = createRouter({
  listPacks: publicQuery.query(async ({ ctx }) => {
    const packs = listPackCodes().map((code) => packSummary(code, loadPack(code)));
    return envelope({ items: packs, next_cursor: null }, ctx);
  }),

  getPack: publicQuery
    .input(z.object({ pack_code: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      try {
        return envelope(
          { ...packSummary(input.pack_code, loadPack(input.pack_code)), pack: loadPack(input.pack_code) },
          ctx,
        );
      } catch {
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "PACK_NOT_FOUND",
          message: `Onboarding pack ${input.pack_code} not found`,
        });
      }
    }),

  onboard: steward
    .input(onboardInputSchema)
    .mutation(async ({ ctx, input }) => {
      let pack;
      try {
        pack = loadPack(input.pack_code);
      } catch {
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "PACK_NOT_FOUND",
          message: `Onboarding pack ${input.pack_code} not found`,
        });
      }
      if (input.idempotency_key) {
        const existing = await findJobByIdempotencyKey(input.idempotency_key);
        if (existing) {
          return envelope(
            { job_id: existing.jobId, status: existing.status, deduplicated: true },
            ctx,
          );
        }
      }
      const jobId = `job:${nanoid(16)}`;
      await insertJob({
        jobId,
        type: "onboarding.onboard",
        status: "queued",
        progress: 0,
        input: {
          pack_code: input.pack_code,
          actor_id: ctx.user.id,
          request_id: requestMeta(ctx).request_id,
        },
        idempotencyKey: input.idempotency_key ?? null,
        actorId: ctx.user.id,
      });
      onboardingRunner.enqueue({
        jobId,
        type: "onboarding.onboard",
        input: { pack_code: input.pack_code, actor_id: ctx.user.id },
      });
      audit(ctx, "onboarding.onboard.requested", {
        type: "job",
        id: jobId,
        scopes: ["onboarding:run"],
        payload: { pack_code: input.pack_code, jurisdiction_id: pack.jurisdiction.id },
      });
      return envelope(
        { job_id: jobId, status: "queued" as const, jurisdiction_id: pack.jurisdiction.id },
        ctx,
      );
    }),

  status: authedQuery
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
          result: job.result ?? null,
          error: job.error ?? null,
        },
        ctx,
      );
    }),

  jurisdictions: publicQuery.query(async ({ ctx }) =>
    envelope({ items: await jurisdictionProvenanceSummaries(), next_cursor: null }, ctx),
  ),
});

export default onboardingRouter;
