import { randomUUID } from "node:crypto";
import { eq, lt, isNull, sql } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./queries/connection";
import { dbJobStore, updateJob } from "./queries/admin";
import {
  createConsumer,
  deliverWebhooks,
  emitEvent,
  Topics,
  webhooksEnabled,
  type ConsumerHandle,
  type DomainEvent,
} from "./utils/events";
import { redactPayload, logRedactionEvent, type RedactionCounts } from "./utils/pii";
import { exportWormNow, startWormExporter } from "./utils/worm";
import { eventConsumerLag } from "./utils/metrics";
import { createIndexerHandler, INDEXER_TOPICS } from "./consumers/opensearch-indexer";

/**
 * Real event consumers (closes EVT-1/EVT-2 "eventing is one-way") plus job
 * hardening (SR-9 heartbeats + stuck-job sweeper). Started from api/boot.ts
 * behind EVENT_CONSUMERS (default on; set EVENT_CONSUMERS=0 to disable).
 *
 * Consumers:
 *  - simulations.run.completed  -> twin recalibration trigger hook + notification stub
 *  - ingest.raw.received        -> loader hook (PII-redacted payload log)
 *  - recommendations.generated  -> audit trail (webhook fan-out already on emit)
 *  - audit.events               -> WORM exporter kick (hourly interval also runs)
 */

const handles: ConsumerHandle[] = [];
let sweeperTimer: ReturnType<typeof setInterval> | null = null;
let lagTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Gap #28: sample the event_consumer_lag gauge. In outbox mode (no Kafka)
 * lag = undelivered event_outbox rows per topic; the same count is the
 * honest backlog signal when Kafka is down, because undelivered rows pile
 * up for the relay. Exported for tests.
 */
export async function sampleConsumerLag(): Promise<void> {
  const rows = await getDb()
    .select({
      topic: schema.eventOutbox.topic,
      n: sql<number>`count(*)`,
    })
    .from(schema.eventOutbox)
    .where(isNull(schema.eventOutbox.deliveredAt))
    .groupBy(schema.eventOutbox.topic);
  const byTopic = new Map(rows.map((r) => [r.topic, Number(r.n)]));
  for (const h of handles) {
    eventConsumerLag.set(
      { topic: h.topic, group: h.group },
      byTopic.get(h.topic) ?? 0,
    );
  }
}

/**
 * Observability/test hook: the currently registered consumer handles
 * (topic, group, transport mode). Empty before startConsumers().
 */
export function registeredConsumers(): ReadonlyArray<
  Pick<ConsumerHandle, "topic" | "group" | "mode">
> {
  return handles.map((h) => ({ topic: h.topic, group: h.group, mode: h.mode }));
}

/* ------------------------- job heartbeats (SR-9) ------------------------ */

/** Stamp a heartbeat row for a job (runner lifecycle transition). */
export async function recordJobHeartbeat(
  jobId: string,
  status: string,
): Promise<void> {
  await getDb()
    .insert(schema.jobHeartbeats)
    .values({ jobId, status, ts: new Date() })
    .onDuplicateKeyUpdate({ set: { status, ts: new Date() } });
}

/**
 * Wrap a JobStore so every lifecycle transition also writes a heartbeat.
 * Applied to the singleton dbJobStore at startup (the runner holds the same
 * object reference, so its calls flow through the wrapper).
 */
export function wrapJobStoreWithHeartbeats<T extends Record<string, unknown>>(
  store: T,
): T {
  for (const key of ["setRunning", "setProgress", "setSucceeded", "setFailed"] as const) {
    const original = store[key] as
      | ((jobId: string, ...args: unknown[]) => Promise<void>)
      | undefined;
    if (typeof original !== "function") continue;
    const status = key === "setRunning" ? "running"
      : key === "setSucceeded" ? "succeeded"
      : key === "setFailed" ? "failed"
      : "running";
    (store as Record<string, unknown>)[key] = (async (jobId: string, ...args: unknown[]) => {
      await original.call(store, jobId, ...args);
      await recordJobHeartbeat(jobId, status).catch((err) =>
        console.error("[jobs] heartbeat failed:", err));
    });
  }
  return store;
}

export const STALE_JOB_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Sweeper: jobs whose heartbeat is stale (>10min) while the jobs row still
 * says queued/running are auto-marked failed and an ops.alerts event fires.
 */
export async function sweepStaleJobs(
  staleMs = STALE_JOB_MS,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - staleMs);
  const stale = await getDb()
    .select()
    .from(schema.jobHeartbeats)
    .where(lt(schema.jobHeartbeats.ts, cutoff));
  let failed = 0;
  for (const hb of stale) {
    if (hb.status !== "running" && hb.status !== "queued") continue;
    const jobs = await getDb()
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.jobId, hb.jobId))
      .limit(1);
    const job = jobs[0];
    if (!job || (job.status !== "running" && job.status !== "queued")) continue;
    await updateJob(hb.jobId, {
      status: "failed" as never,
      error: `stuck job: no heartbeat for ${Math.round(staleMs / 60000)}min`,
      finishedAt: new Date(),
    });
    await recordJobHeartbeat(hb.jobId, "failed").catch(() => undefined);
    await emitEvent(
      Topics.opsAlerts,
      { job_id: hb.jobId, type: job.type, reason: "stuck-job-auto-failed" },
      hb.jobId,
    );
    failed += 1;
  }
  return failed;
}

/* ------------------------------ consumers ----------------------------- */

async function onSimulationCompleted(event: DomainEvent): Promise<void> {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  // Recalibration trigger hook: the adaptive twin loop (api/runner.ts twin
  // helpers) consumes live metric deltas; here we emit the trigger signal.
  console.info(
    `[consumers] simulations.run.completed job=${payload.job_id ?? "-"} ` +
      `-> recalibration trigger queued`,
  );
  // Gap #17: operator notification goes through the real webhook fan-out
  // (subscriptions on ops.alerts / "*"); console remains the fallback when
  // nobody subscribes.
  await notifyOps(
    "simulation.result_ready",
    {
      job_id: payload.job_id ?? null,
      jurisdiction_id:
        (payload as { jurisdiction_id?: string }).jurisdiction_id ?? "unknown",
      simulation_run_id: payload.simulation_run_id ?? null,
    },
    String(payload.job_id ?? event.event_id),
  );
}

/**
 * Route an operator notification through the existing webhook fan-out
 * (api/utils/events.ts). Falls back to console when there are no active
 * subscribers (or delivery is disabled in tests).
 */
export async function notifyOps(
  type: string,
  details: Record<string, unknown>,
  partitionKey?: string,
): Promise<void> {
  const event: DomainEvent = {
    event_id: `evt_${randomUUID()}`,
    topic: Topics.opsAlerts,
    partition_key: partitionKey ?? null,
    payload: { type, ...details, ts: new Date().toISOString() },
    occurred_at: new Date().toISOString(),
  };
  let delivered = 0;
  if (webhooksEnabled()) {
    delivered = await deliverWebhooks(event).catch((err) => {
      console.error("[consumers] notification webhook delivery error:", err);
      return 0;
    });
  }
  if (delivered === 0) {
    console.info(
      `[consumers] notification (no webhook subscribers): ${type} ${JSON.stringify(details)}`,
    );
  }
}

async function onIngestRawReceived(event: DomainEvent): Promise<void> {
  // Loader hook: redact field-data payloads before they touch logs/stores.
  const counts: RedactionCounts = {};
  const safe = redactPayload(event.payload ?? {}, undefined, counts);
  logRedactionEvent("consumer.ingest.raw.received", counts);
  const p = (safe ?? {}) as Record<string, unknown>;
  console.info(
    `[consumers] ingest.raw.received source=${p.source ?? "-"} ` +
      `records=${p.record_count ?? "-"} -> loader hook queued`,
  );
}

async function onRecommendationGenerated(event: DomainEvent): Promise<void> {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const { insertAuditEvent } = await import("./queries/audit");
  await insertAuditEvent({
    actorId: null,
    action: "recommendations.generated.consumed",
    entityType: "job",
    entityId: String(payload.job_id ?? event.event_id),
    payload: { event_id: event.event_id, tier: payload.tier ?? null } as never,
  });
}

let lastWormKick = 0;
async function onAuditEvent(_event: DomainEvent): Promise<void> {
  // Throttled WORM kick: at most one export per 5 minutes from the consumer
  // (the hourly interval is the steady-state exporter).
  if (Date.now() - lastWormKick < 5 * 60 * 1000) return;
  lastWormKick = Date.now();
  await exportWormNow();
}

/** Start all consumers + sweeper + WORM interval. Idempotent. */
export async function startConsumers(): Promise<void> {
  if (handles.length > 0) return;
  wrapJobStoreWithHeartbeats(dbJobStore as never);

  const defs: [string, (e: DomainEvent) => Promise<void>][] = [
    [Topics.simulationsRunCompleted, onSimulationCompleted],
    [Topics.ingestRawReceived, onIngestRawReceived],
    [Topics.recommendationsGenerated, onRecommendationGenerated],
    [Topics.auditEvents, onAuditEvent],
  ];
  // OpenSearch indexer (docs/OPENSEARCH.md): only registered when a cluster
  // is configured — with OPENSEARCH_URL unset the platform runs SQL-only.
  if (process.env.OPENSEARCH_URL) {
    const indexer = createIndexerHandler();
    for (const topic of INDEXER_TOPICS) {
      defs.push([topic, indexer]);
    }
  }
  for (const [topic, handler] of defs) {
    const handle = createConsumer(topic, handler, {
      group: `policy-twin-${topic}`,
    });
    await handle.start();
    handles.push(handle);
  }

  sweeperTimer = setInterval(() => {
    sweepStaleJobs().catch((err) =>
      console.error("[jobs] stale-job sweeper error:", err));
  }, 60_000);
  sweeperTimer.unref?.();

  lagTimer = setInterval(() => {
    sampleConsumerLag().catch((err) =>
      console.error("[consumers] lag sampler error:", err));
  }, 15_000);
  lagTimer.unref?.();
  void sampleConsumerLag().catch(() => undefined);

  startWormExporter();
}

export async function stopConsumers(): Promise<void> {
  await Promise.all(handles.map((h) => h.stop()));
  handles.length = 0;
  if (sweeperTimer) clearInterval(sweeperTimer);
  sweeperTimer = null;
  if (lagTimer) clearInterval(lagTimer);
  lagTimer = null;
}
