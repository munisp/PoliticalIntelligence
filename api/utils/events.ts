import { createHmac, randomUUID } from "node:crypto";
import { eq, isNull, asc } from "drizzle-orm";
import * as schema from "@db/schema";
import { EventTopics, type EventTopic } from "@contracts/entities";
import { validateEventPayload } from "@contracts/events";
import { getDb } from "../queries/connection";
import { eventsEmittedTotal } from "./metrics";

/**
 * Pragmatic event bus (docs/EVENTS.md topic catalog).
 *
 * Delivery order:
 *  1. If KAFKA_BROKERS is set and the optional `kafkajs` dependency is
 *     installed, publish to Redpanda/Kafka (producer cached per process).
 *  2. Otherwise (or on Kafka failure) persist to the durable `event_outbox`
 *     table; a relay loop retries delivery and stamps delivered_at.
 *  3. Active webhook subscriptions receive HMAC-SHA256 signed payloads
 *     (X-PolicyTwin-Signature) with 3-retry exponential backoff.
 *
 * Emitters: job lifecycle (runner), scenario runs, recommendations,
 * approvals — see emitEvent() call sites.
 */

export interface DomainEvent {
  event_id: string;
  topic: EventTopic | string;
  partition_key?: string | null;
  payload: unknown;
  occurred_at: string;
}

/* ------------------------------- Kafka ------------------------------- */

type KafkaProducer = {
  connect(): Promise<void>;
  send(batch: {
    topic: string;
    messages: { key?: string; value: string }[];
  }): Promise<unknown>;
  disconnect(): Promise<void>;
};

let producerPromise: Promise<KafkaProducer | null> | null = null;

async function getProducer(): Promise<KafkaProducer | null> {
  if (!process.env.KAFKA_BROKERS) return null;
  producerPromise ??= (async () => {
    try {
      // Optional dependency: guard the import so the API runs without it.
      const mod = (await import("kafkajs" as string).catch(() => null)) as {
        Kafka?: new (cfg: unknown) => {
          producer(): KafkaProducer;
        };
      } | null;
      if (!mod?.Kafka) return null;
      const kafka = new mod.Kafka({
        clientId: "policy-twin-api",
        brokers: process.env.KAFKA_BROKERS!.split(","),
      });
      const producer = kafka.producer();
      await producer.connect();
      return producer;
    } catch (err) {
      console.error("[events] kafka producer init failed, using outbox:", err);
      return null;
    }
  })();
  return producerPromise;
}

/* ------------------------------ Outbox ------------------------------- */

async function persistOutbox(event: DomainEvent): Promise<void> {
  await getDb()
    .insert(schema.eventOutbox)
    .values({
      eventId: event.event_id,
      topic: event.topic,
      partitionKey: event.partition_key ?? null,
      payload: event.payload as never,
    })
    .catch((err) => console.error("[events] outbox insert failed:", err));
}

/**
 * Emit a domain event. Kafka when available; the durable outbox is the
 * fallback (and the webhook fan-out source). Never throws into callers.
 */
export async function emitEvent(
  topic: EventTopic | string,
  payload: unknown,
  partitionKey?: string,
): Promise<void> {
  // §40 schema pack (API-8): payloads are validated against the per-topic
  // zod schema before they may leave the process. Invalid payloads are
  // dropped (never published to Kafka/outbox/webhooks) and logged.
  const validation = validateEventPayload(topic, payload);
  if (!validation.ok) {
    console.error(
      `[events] schema validation failed for ${topic}, event dropped: ${validation.error}`,
    );
    return;
  }
  const event: DomainEvent = {
    event_id: `evt_${randomUUID()}`,
    topic,
    partition_key: partitionKey ?? null,
    payload,
    occurred_at: new Date().toISOString(),
  };
  eventsEmittedTotal.inc({ topic });
  try {
    const producer = await getProducer();
    if (producer) {
      await producer.send({
        topic,
        messages: [
          {
            ...(event.partition_key ? { key: event.partition_key } : {}),
            value: JSON.stringify(event),
          },
        ],
      });
      return;
    }
  } catch (err) {
    console.error(`[events] kafka send failed for ${topic}, falling back to outbox:`, err);
  }
  await persistOutbox(event);
  // Webhook fan-out is best-effort and asynchronous.
  void deliverWebhooks(event).catch((err) =>
    console.error("[events] webhook delivery error:", err),
  );
}

/**
 * Outbox relay: attempt delivery of undelivered rows (Kafka only; rows
 * already fanned out to webhooks stay until Kafka accepts them).
 * Started lazily; no-op when Kafka is unavailable.
 */
let relayTimer: ReturnType<typeof setInterval> | null = null;

export async function relayOutboxOnce(limit = 50): Promise<number> {
  const producer = await getProducer();
  if (!producer) return 0;
  const rows = await getDb()
    .select()
    .from(schema.eventOutbox)
    .where(isNull(schema.eventOutbox.deliveredAt))
    .orderBy(asc(schema.eventOutbox.createdAt))
    .limit(limit);
  let delivered = 0;
  for (const row of rows) {
    try {
      await producer.send({
        topic: row.topic,
        messages: [
          {
            ...(row.partitionKey ? { key: row.partitionKey } : {}),
            value: JSON.stringify(row.payload),
          },
        ],
      });
      await getDb()
        .update(schema.eventOutbox)
        .set({ deliveredAt: new Date() })
        .where(eq(schema.eventOutbox.eventId, row.eventId));
      delivered += 1;
    } catch (err) {
      await getDb()
        .update(schema.eventOutbox)
        .set({
          attempts: row.attempts + 1,
          lastError: err instanceof Error ? err.message : String(err),
        })
        .where(eq(schema.eventOutbox.eventId, row.eventId));
    }
  }
  return delivered;
}

export function startOutboxRelay(intervalMs = 10_000): void {
  if (relayTimer || !process.env.KAFKA_BROKERS) return;
  relayTimer = setInterval(() => {
    relayOutboxOnce().catch((err) => console.error("[events] relay error:", err));
  }, intervalMs);
  relayTimer.unref?.();
}

export function stopOutboxRelay(): void {
  if (relayTimer) clearInterval(relayTimer);
  relayTimer = null;
}

/* ------------------------------ Webhooks ----------------------------- */

export function signWebhookPayload(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Deliver one event to matching active subscriptions (3-retry backoff). */
export async function deliverWebhooks(event: DomainEvent): Promise<number> {
  const subs = await getDb()
    .select()
    .from(schema.webhookSubscriptions)
    .where(eq(schema.webhookSubscriptions.active, 1));
  const matching = subs.filter((s) => {
    const topics = Array.isArray(s.topics) ? (s.topics as string[]) : [];
    return topics.includes(event.topic) || topics.includes("*");
  });
  let delivered = 0;
  // Deliver to subscriptions concurrently: with many active subscriptions a
  // sequential loop multiplies worst-case latency by subscription count.
  // Each subscription still gets its own bounded 3-attempt backoff.
  await Promise.all(matching.map(async (sub) => {
    const body = JSON.stringify(event);
    const signature = signWebhookPayload(sub.secret, body);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const resp = await fetch(sub.url, {
          method: "POST",
          // Bound delivery latency: an unreachable endpoint must fail fast so
          // retries/backoff (and callers like the ping-test procedure) return.
          signal: AbortSignal.timeout(
            Number(process.env.WEBHOOK_TIMEOUT_MS ?? 5_000),
          ),
          headers: {
            "Content-Type": "application/json",
            "X-PolicyTwin-Signature": signature,
            "X-PolicyTwin-Event": event.topic,
            "X-PolicyTwin-Delivery": event.event_id,
          },
          body,
        });
        if (resp.ok) {
          delivered += 1;
          break;
        }
        throw new Error(`webhook ${sub.subId} -> HTTP ${resp.status}`);
      } catch (err) {
        if (attempt === 2) {
          console.error(
            `[events] webhook ${sub.subId} delivery failed after 3 attempts:`,
            err instanceof Error ? err.message : err,
          );
        } else {
          await sleep(250 * 2 ** attempt); // 250ms, 500ms backoff
        }
      }
    }
  }));
  return delivered;
}

/* ------------------------------ Consumers ---------------------------- */

/**
 * Consumer framework (closes the "eventing is one-way" gap, docs/EVENTS.md).
 *
 * `createConsumer(topic, handler, {group})` gives at-least-once delivery
 * with per-topic retry (3 attempts, exponential backoff) and a dead-letter
 * sink (`<topic>.dlq` in Kafka mode; the `event_dlq` table in outbox mode).
 *
 * Two transports, selected the same way as the producer side:
 *  - Kafka (kafkajs, env KAFKA_BROKERS): a real consumer group; exhausted
 *    messages are published to the DLQ topic AND recorded in `event_dlq`.
 *  - Outbox fallback (no brokers): a polled loop over `event_outbox` rows
 *    for the topic with identical retry/DLQ semantics; processed rows are
 *    stamped delivered_at so the loop makes progress.
 *
 * Idempotency: each consumer dedups by event_id for the lifetime of the
 * process (and skips event_ids already present in `event_dlq`).
 */

export type ConsumerHandler = (event: DomainEvent) => Promise<void>;

export interface ConsumerOptions {
  group?: string;
  /** Delivery attempts before dead-lettering (default 3). */
  maxRetries?: number;
  /** Base backoff in ms between retries (default 250; doubles each retry). */
  backoffMs?: number;
  /** Outbox-mode poll interval (default 5000). */
  pollIntervalMs?: number;
}

export interface ConsumerHandle {
  topic: string;
  group: string;
  mode: "kafka" | "outbox";
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Process one event synchronously with retry/DLQ semantics (testable). */
  process(event: DomainEvent): Promise<"ok" | "dlq" | "duplicate">;
}

export const dlqTopicFor = (topic: string) => `${topic}.dlq`;

async function recordDeadLetter(
  event: DomainEvent,
  group: string,
  attempts: number,
  lastError: string,
): Promise<void> {
  await getDb()
    .insert(schema.eventDlq)
    .values({
      eventId: event.event_id,
      topic: event.topic,
      dlqTopic: dlqTopicFor(event.topic),
      partitionKey: event.partition_key ?? null,
      payload: event.payload as never,
      attempts,
      lastError,
      consumerGroup: group,
    })
    .catch((err) => console.error("[events] dlq insert failed:", err));
}

export function createConsumer(
  topic: string,
  handler: ConsumerHandler,
  opts: ConsumerOptions = {},
): ConsumerHandle {
  const group = opts.group ?? `policy-twin-${topic}`;
  const maxRetries = opts.maxRetries ?? 3;
  const backoffMs = opts.backoffMs ?? 250;
  const pollIntervalMs = opts.pollIntervalMs ?? 5_000;
  const seen = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let kafkaConsumer: { connect(): Promise<void>; subscribe(c: unknown): Promise<void>; run(c: unknown): Promise<void>; disconnect(): Promise<void> } | null = null;

  async function alreadyDead(eventId: string): Promise<boolean> {
    const { and } = await import("drizzle-orm");
    const rows = await getDb()
      .select({ eventId: schema.eventDlq.eventId })
      .from(schema.eventDlq)
      .where(
        and(
          eq(schema.eventDlq.eventId, eventId),
          // Replayed rows are back on the bus — not dead anymore.
          isNull(schema.eventDlq.replayedAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async function processEvent(event: DomainEvent): Promise<"ok" | "dlq" | "duplicate"> {
    if (seen.has(event.event_id)) return "duplicate";
    seen.add(event.event_id);
    let lastError = "";
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await handler(event);
        return "ok";
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < maxRetries) await sleep(backoffMs * 2 ** (attempt - 1));
      }
    }
    await recordDeadLetter(event, group, maxRetries, lastError);
    return "dlq";
  }

  async function startKafka(): Promise<boolean> {
    if (!process.env.KAFKA_BROKERS) return false;
    try {
      const mod = (await import("kafkajs" as string).catch(() => null)) as {
        Kafka?: new (cfg: unknown) => {
          consumer(cfg: unknown): NonNullable<typeof kafkaConsumer>;
        };
      } | null;
      if (!mod?.Kafka) return false;
      const kafka = new mod.Kafka({
        clientId: "policy-twin-api",
        brokers: process.env.KAFKA_BROKERS.split(","),
      });
      const consumer = kafka.consumer({ groupId: group });
      await consumer.connect();
      await consumer.subscribe({ topic, fromBeginning: false });
      await consumer.run({
        eachMessage: async ({ message }: { message: { value?: Buffer | null } }) => {
          if (!message.value) return;
          const event = JSON.parse(message.value.toString()) as DomainEvent;
          const outcome = await processEvent(event);
          if (outcome === "dlq") {
            const producer = await getProducer();
            await producer?.send({
              topic: dlqTopicFor(topic),
              messages: [{ value: JSON.stringify(event) }],
            }).catch(() => undefined);
          }
        },
      });
      kafkaConsumer = consumer;
      return true;
    } catch (err) {
      console.error(`[events] kafka consumer ${group} failed, using outbox:`, err);
      return false;
    }
  }

  /** Outbox-mode single poll pass (exported semantics for tests). */
  async function pollOutboxOnce(limit = 50): Promise<number> {
    const { and } = await import("drizzle-orm");
    const rows = await getDb()
      .select()
      .from(schema.eventOutbox)
      .where(
        and(
          isNull(schema.eventOutbox.deliveredAt),
          eq(schema.eventOutbox.topic, topic),
        ),
      )
      .orderBy(asc(schema.eventOutbox.createdAt))
      .limit(limit);
    let processed = 0;
    for (const row of rows) {
      const event: DomainEvent = {
        event_id: row.eventId,
        topic: row.topic,
        partition_key: row.partitionKey,
        payload: row.payload,
        occurred_at: row.createdAt.toISOString(),
      };
      if (await alreadyDead(event.event_id)) {
        await getDb()
          .update(schema.eventOutbox)
          .set({ deliveredAt: new Date() })
          .where(eq(schema.eventOutbox.eventId, row.eventId));
        continue;
      }
      const outcome = await processEvent(event);
      await getDb()
        .update(schema.eventOutbox)
        .set({
          ...(outcome !== "duplicate" ? { deliveredAt: new Date() } : {}),
          attempts: row.attempts + 1,
          lastError: outcome === "dlq" ? "dead-lettered" : row.lastError,
        })
        .where(eq(schema.eventOutbox.eventId, row.eventId));
      if (outcome !== "duplicate") processed += 1;
    }
    return processed;
  }

  return {
    topic,
    group,
    mode: process.env.KAFKA_BROKERS ? "kafka" : "outbox",
    process: processEvent,
    async start() {
      if (await startKafka()) return;
      if (timer) return;
      timer = setInterval(() => {
        pollOutboxOnce().catch((err) =>
          console.error(`[events] outbox consumer ${group} poll error:`, err));
      }, pollIntervalMs);
      timer.unref?.();
      // Kick one pass immediately so tests/boot don't wait a full interval.
      void pollOutboxOnce().catch(() => undefined);
    },
    async stop() {
      if (timer) clearInterval(timer);
      timer = null;
      await kafkaConsumer?.disconnect().catch(() => undefined);
      kafkaConsumer = null;
    },
  };
}

/* ------------------------------ Replay ------------------------------- */

export interface ReplayOptions {
  topic: string;
  /** Only rows created at/after this ISO timestamp. */
  since?: string;
  limit?: number;
  /** Which backlog to replay: dead-lettered rows, stuck outbox rows, both. */
  source?: "dlq" | "outbox" | "both";
  /** Actor id recorded in the replay audit event. */
  actorId?: number | null;
}

export interface ReplayResult {
  topic: string;
  mode: "kafka" | "outbox";
  replayed_dlq: number;
  replayed_outbox: number;
}

/**
 * Event replay (docs/EVENTS.md §replay; gap EVT-2).
 *
 *  - DLQ rows are REQUEUED: removed from `event_dlq` and reset in
 *    `event_outbox` (attempts=0, delivered_at=NULL) so the consumer group
 *    picks them up again with full retry semantics. In Kafka mode the
 *    event is published back to its source topic directly.
 *  - Stuck outbox rows (undelivered, attempts>0) are reset for another
 *    relay pass when source includes "outbox".
 *
 * Every replay is recorded in the audit trail (`events.replayed`).
 */
export async function replayEvents(opts: ReplayOptions): Promise<ReplayResult> {
  const { and, gte, isNotNull } = await import("drizzle-orm");
  const topic = opts.topic;
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
  const source = opts.source ?? "dlq";
  const producer = await getProducer();
  const mode = producer ? "kafka" : "outbox";
  const sinceDate = opts.since ? new Date(opts.since) : null;

  let replayedDlq = 0;
  let replayedOutbox = 0;

  if (source === "dlq" || source === "both") {
    // Only unreplayed rows: re-replaying an already-replayed dead letter is
    // a no-op (its outbox row was already reset) and expensive on large DLQs.
    const conds = [
      eq(schema.eventDlq.topic, topic),
      isNull(schema.eventDlq.replayedAt),
    ];
    if (sinceDate) conds.push(gte(schema.eventDlq.createdAt, sinceDate));
    const rows = await getDb()
      .select()
      .from(schema.eventDlq)
      .where(and(...conds))
      .orderBy(asc(schema.eventDlq.createdAt))
      .limit(limit);
    for (const row of rows) {
      if (producer) {
        // Kafka mode: publish back to the source topic.
        await producer.send({
          topic,
          messages: [
            {
              ...(row.partitionKey ? { key: row.partitionKey } : {}),
              value: JSON.stringify(row.payload),
            },
          ],
        });
      } else {
        // Outbox mode: reset the outbox row so the polled consumer group
        // re-processes it (consumers skip event_ids still present in DLQ,
        // so the DLQ row is deleted below).
        await getDb()
          .insert(schema.eventOutbox)
          .values({
            eventId: row.eventId,
            topic: row.topic,
            partitionKey: row.partitionKey ?? null,
            payload: row.payload as never,
            attempts: 0,
            lastError: null,
            deliveredAt: null,
          })
          .onDuplicateKeyUpdate({
            set: { attempts: 0, lastError: null, deliveredAt: null },
          });
      }
      // Stamp (not delete) the DLQ row: the replay itself is auditable.
      // Consumers ignore DLQ rows that have been replayed (see alreadyDead).
      await getDb()
        .update(schema.eventDlq)
        .set({ replayedAt: new Date() })
        .where(eq(schema.eventDlq.eventId, row.eventId));
      replayedDlq += 1;
    }
  }

  if (source === "outbox" || source === "both") {
    // Stuck undelivered outbox rows (relay exhausted): reset attempts.
    const conds = [
      eq(schema.eventOutbox.topic, topic),
      isNull(schema.eventOutbox.deliveredAt),
      isNotNull(schema.eventOutbox.lastError),
    ];
    if (sinceDate) conds.push(gte(schema.eventOutbox.createdAt, sinceDate));
    const stuck = await getDb()
      .select({ eventId: schema.eventOutbox.eventId })
      .from(schema.eventOutbox)
      .where(and(...conds))
      .limit(limit);
    for (const row of stuck) {
      await getDb()
        .update(schema.eventOutbox)
        .set({ attempts: 0, lastError: null })
        .where(eq(schema.eventOutbox.eventId, row.eventId));
      replayedOutbox += 1;
    }
  }

  // Replay audit (tamper-evident chain via insertAuditEvent).
  try {
    const { insertAuditEvent } = await import("../queries/audit");
    await insertAuditEvent({
      actorId: opts.actorId ?? null,
      action: "events.replayed",
      entityType: "event_topic",
      entityId: topic,
      payload: {
        topic,
        mode,
        source,
        since: opts.since ?? null,
        replayed_dlq: replayedDlq,
        replayed_outbox: replayedOutbox,
      } as never,
    });
  } catch (err) {
    console.error("[events] replay audit insert failed:", err);
  }

  return { topic, mode, replayed_dlq: replayedDlq, replayed_outbox: replayedOutbox };
}

/* --------------------------- Emit helpers ---------------------------- */

export const Topics = EventTopics;

/** Job lifecycle events (queued/running/succeeded/failed). */
export async function emitJobLifecycle(
  status: "queued" | "running" | "succeeded" | "failed",
  job: { jobId: string; type: string },
  extra?: Record<string, unknown>,
): Promise<void> {
  const topicByStatus: Record<string, string> = {
    queued: EventTopics.scenariosRunRequested,
    succeeded:
      job.type === "simulations.run"
        ? EventTopics.simulationsRunCompleted
        : job.type === "opportunities.generate"
          ? EventTopics.recommendationsGenerated
          : job.type === "briefs.generate"
            ? EventTopics.reportsGenerated
            : EventTopics.opsAlerts,
    failed: EventTopics.opsAlerts,
    running: EventTopics.opsAlerts,
  };
  await emitEvent(
    topicByStatus[status] ?? EventTopics.opsAlerts,
    { job_id: job.jobId, type: job.type, status, ...extra },
    job.jobId,
  );
}
