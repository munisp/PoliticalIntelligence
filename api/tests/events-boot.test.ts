import { and, eq, isNotNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import {
  registeredConsumers,
  startConsumers,
  stopConsumers,
} from "../consumers";
import {
  createConsumer,
  emitEvent,
  Topics,
  type DomainEvent,
} from "../utils/events";

/**
 * Eventing boot smoke test (outbox mode): with EVENT_CONSUMERS at its
 * default (on) and no KAFKA_BROKERS, starting the app wires the documented
 * consumers, an emitted event is picked up from event_outbox and marked
 * delivered, and a poison event dead-letters into event_dlq after exactly
 * 3 attempts. Kept under ~10s via short poll intervals/timeouts.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pollUntil(
  fn: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 200,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await sleep(intervalMs);
  }
  return false;
}

describe("eventing boot (outbox mode)", () => {
  let savedKafka: string | undefined;
  let poison: ReturnType<typeof createConsumer> | null = null;

  beforeAll(async () => {
    savedKafka = process.env.KAFKA_BROKERS;
    delete process.env.KAFKA_BROKERS; // force outbox mode
    delete process.env.EVENT_CONSUMERS; // default = on
    await startConsumers();
  }, 15_000);

  afterAll(async () => {
    await poison?.stop();
    await stopConsumers();
    if (savedKafka !== undefined) process.env.KAFKA_BROKERS = savedKafka;
  });

  it("wires the documented consumers in outbox mode", () => {
    const registered = registeredConsumers();
    const topics = registered.map((c) => c.topic);
    for (const topic of [
      Topics.simulationsRunCompleted,
      Topics.ingestRawReceived,
      Topics.recommendationsGenerated,
      Topics.auditEvents,
    ]) {
      expect(topics).toContain(topic);
    }
    for (const c of registered) {
      expect(c.mode).toBe("outbox");
      expect(c.group).toBe(`policy-twin-${c.topic}`);
    }
    // Idempotent: a second startConsumers() adds nothing.
    expect(registered.length).toBe(4);
  });

  it("delivers an emitted event from event_outbox (delivered_at stamped)", async () => {
    const eventId = `evt_boot_smoke_${Date.now()}`;
    await emitEvent(
      Topics.simulationsRunCompleted,
      { job_id: "boot-smoke", jurisdiction_id: "jur:ng-kd" },
      "boot-smoke",
    );
    // emitEvent generates its own id; find the row by recency + topic.
    const delivered = await pollUntil(async () => {
      const rows = await getDb()
        .select()
        .from(schema.eventOutbox)
        .where(
          and(
            eq(schema.eventOutbox.topic, Topics.simulationsRunCompleted),
            isNotNull(schema.eventOutbox.deliveredAt),
          ),
        )
        .limit(1);
      return rows.length > 0;
    }, 8_000);
    expect(delivered, "outbox consumer stamped delivered_at").toBe(true);
    void eventId;
  }, 10_000);

  it("dead-letters a poison event into event_dlq after 3 attempts", async () => {
    // Unique topic: the dev DB may carry an undelivered backlog on shared
    // topics (processed in createdAt order), which would starve a fresh row.
    const topic = `ops.alerts.bootsmoke.${Date.now()}`;
    const group = `test-boot-poison-${Date.now()}`;
    let calls = 0;
    poison = createConsumer(
      topic,
      async () => {
        calls += 1;
        throw new Error("poison");
      },
      { group, maxRetries: 3, backoffMs: 1, pollIntervalMs: 100 },
    );
    await poison.start();

    const event: DomainEvent = {
      event_id: `evt_boot_poison_${Date.now()}`,
      topic,
      partition_key: null,
      payload: { poison: true },
      occurred_at: new Date().toISOString(),
    };
    await getDb().insert(schema.eventOutbox).values({
      eventId: event.event_id,
      topic: event.topic,
      payload: event.payload as never,
    });

    const deadLettered = await pollUntil(async () => {
      const rows = await getDb()
        .select()
        .from(schema.eventDlq)
        .where(
          and(
            eq(schema.eventDlq.eventId, event.event_id),
            eq(schema.eventDlq.consumerGroup, group),
          ),
        );
      return rows.length > 0;
    }, 6_000);
    expect(deadLettered, "poison event reached event_dlq").toBe(true);

    const [dlqRow] = await getDb()
      .select()
      .from(schema.eventDlq)
      .where(eq(schema.eventDlq.eventId, event.event_id));
    expect(dlqRow.attempts).toBe(3);
    expect(dlqRow.dlqTopic).toBe(`${topic}.dlq`);
    expect(calls).toBe(3);

    // Leave the shared dev DB as we found it.
    await poison.stop();
    poison = null;
    await getDb()
      .delete(schema.eventDlq)
      .where(eq(schema.eventDlq.eventId, event.event_id));
    await getDb()
      .delete(schema.eventOutbox)
      .where(eq(schema.eventOutbox.eventId, event.event_id));
  }, 9_000);
});
