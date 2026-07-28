import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as schema from "@db/schema";
import { registerEventSchema } from "@contracts/events";
import { getDb } from "../queries/connection";
import {
  createConsumer,
  dlqTopicFor,
  emitEvent,
  type DomainEvent,
} from "../utils/events";

function makeEvent(id: string): DomainEvent {
  return {
    event_id: id,
    topic: "ops.alerts",
    partition_key: null,
    payload: { id },
    occurred_at: new Date().toISOString(),
  };
}

describe("event consumers", () => {
  it("retries with backoff then dead-letters to the DLQ", async () => {
    let calls = 0;
    const consumer = createConsumer(
      "ops.alerts",
      async () => {
        calls += 1;
        throw new Error("handler always fails");
      },
      { group: "test-dlq", maxRetries: 3, backoffMs: 1 },
    );
    const event = makeEvent(`evt_test_dlq_${Date.now()}`);
    const outcome = await consumer.process(event);
    expect(outcome).toBe("dlq");
    expect(calls).toBe(3);
    const rows = await getDb()
      .select()
      .from(schema.eventDlq)
      .where(eq(schema.eventDlq.eventId, event.event_id));
    expect(rows).toHaveLength(1);
    expect(rows[0].dlqTopic).toBe(dlqTopicFor("ops.alerts"));
    expect(rows[0].attempts).toBe(3);
    expect(rows[0].lastError).toContain("handler always fails");
    expect(rows[0].consumerGroup).toBe("test-dlq");
  });

  it("dedups by event id (idempotent delivery)", async () => {
    let calls = 0;
    const consumer = createConsumer(
      "ops.alerts",
      async () => {
        calls += 1;
      },
      { group: "test-idem", backoffMs: 1 },
    );
    const event = makeEvent(`evt_test_idem_${Date.now()}`);
    expect(await consumer.process(event)).toBe("ok");
    expect(await consumer.process(event)).toBe("duplicate");
    expect(calls).toBe(1);
  });

  it("outbox fallback: emitted event is consumed from event_outbox", async () => {
    // Unique topic -> no shared backlog (outbox consumer polls per-topic).
    // API-8: extension topics must register a payload schema before emit.
    const topic = `test.outbox.${Date.now()}`;
    registerEventSchema(topic, z.looseObject({ marker: z.string() }));
    const received: string[] = [];
    const consumer = createConsumer(
      topic,
      async (e) => {
        received.push(e.event_id);
      },
      { group: "test-outbox", pollIntervalMs: 50, backoffMs: 1 },
    );
    // unique marker payload so we can assert OUR event was delivered
    const marker = `marker_${Date.now()}`;
    await emitEvent(topic, { marker }, marker);
    await consumer.start();
    await new Promise((r) => setTimeout(r, 400));
    await consumer.stop();
    // The outbox row for our marker should be stamped delivered.
    const rows = await getDb()
      .select()
      .from(schema.eventOutbox)
      .where(eq(schema.eventOutbox.partitionKey, marker));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].deliveredAt).not.toBeNull();
  });
});
