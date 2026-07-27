import { createHmac, randomUUID } from "node:crypto";
import { eq, isNull, asc } from "drizzle-orm";
import * as schema from "@db/schema";
import { EventTopics, type EventTopic } from "@contracts/entities";
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
  for (const sub of matching) {
    const body = JSON.stringify(event);
    const signature = signWebhookPayload(sub.secret, body);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const resp = await fetch(sub.url, {
          method: "POST",
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
  }
  return delivered;
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
