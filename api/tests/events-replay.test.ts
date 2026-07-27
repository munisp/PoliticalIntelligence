import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import eventsAdminRouter from "../events-admin";
import { getDb } from "../queries/connection";
import { createConsumer, replayEvents, type DomainEvent } from "../utils/events";
import type { TrpcContext } from "../context";
import type { User } from "@db/schema";

/** Event replay tooling (gap 10 / EVT-2): DLQ + outbox replay with audit. */

function adminCtx(): TrpcContext {
  const user = {
    id: 999010,
    unionId: "replay-admin",
    name: "Replay Admin",
    email: null,
    avatar: null,
    role: "user",
    platformRole: "platform_admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignInAt: new Date(),
  } as User;
  return { req: new Request("http://test.local/"), resHeaders: new Headers(), user };
}

const TOPIC = "ops.alerts";
const EVENT_ID = `evt_replay_test_${Date.now()}`;

async function seedDeadLetter() {
  await getDb()
    .insert(schema.eventOutbox)
    .values({
      eventId: EVENT_ID,
      topic: TOPIC,
      partitionKey: "test",
      payload: { probe: true } as never,
      attempts: 3,
      lastError: "boom",
      deliveredAt: new Date(), // consumed once, then dead-lettered
    })
    .onDuplicateKeyUpdate({
      set: { attempts: 3, lastError: "boom", deliveredAt: new Date() },
    });
  await getDb()
    .insert(schema.eventDlq)
    .values({
      eventId: EVENT_ID,
      topic: TOPIC,
      dlqTopic: `${TOPIC}.dlq`,
      partitionKey: "test",
      payload: { probe: true } as never,
      attempts: 3,
      lastError: "boom",
      consumerGroup: `policy-twin-${TOPIC}`,
    })
    .onDuplicateKeyUpdate({ set: { replayedAt: null } });
}

describe("event replay (eventsAdmin router + replayEvents)", () => {
  it("rejects topics outside the catalog", async () => {
    const caller = eventsAdminRouter.createCaller(adminCtx());
    await expect(
      caller.replay({ topic: "not.a.real.topic" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("replays DLQ rows: stamped replayed_at, outbox reset, audited", async () => {
    await seedDeadLetter();
    const caller = eventsAdminRouter.createCaller(adminCtx());
    const res = await caller.replay({ topic: TOPIC, source: "dlq" });
    expect(res.data.topic).toBe(TOPIC);
    expect(res.data.replayed_dlq).toBeGreaterThanOrEqual(1);

    const dlq = await getDb()
      .select()
      .from(schema.eventDlq)
      .where(eq(schema.eventDlq.eventId, EVENT_ID));
    expect(dlq[0]?.replayedAt).toBeTruthy();

    const outbox = await getDb()
      .select()
      .from(schema.eventOutbox)
      .where(eq(schema.eventOutbox.eventId, EVENT_ID));
    expect(outbox[0]?.attempts).toBe(0);
    expect(outbox[0]?.deliveredAt).toBeNull();

    const auditRows = await getDb()
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "events.replayed"));
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
  });

  it("a replayed event is consumable again (alreadyDead ignores replayed rows)", async () => {
    // Unique topic so the outbox poll sees only this test's row.
    const topic = `ops.alerts.replayprobe.${Date.now()}`;
    const eventId = `evt_replay_probe_${Date.now()}`;
    await getDb().insert(schema.eventOutbox).values({
      eventId,
      topic,
      partitionKey: "test",
      payload: { probe: true } as never,
      attempts: 3,
      lastError: "boom",
      deliveredAt: new Date(),
    });
    await getDb().insert(schema.eventDlq).values({
      eventId,
      topic,
      dlqTopic: `${topic}.dlq`,
      partitionKey: "test",
      payload: { probe: true } as never,
      attempts: 3,
      lastError: "boom",
      consumerGroup: `policy-twin-${topic}`,
    });
    const result = await replayEvents({ topic, source: "dlq" });
    expect(result.replayed_dlq).toBe(1);

    const received: DomainEvent[] = [];
    const consumer = createConsumer(topic, async (e) => {
      received.push(e);
    });
    await consumer.start(); // kicks one immediate outbox poll
    await new Promise((r) => setTimeout(r, 1500));
    await consumer.stop();
    expect(received.some((e) => e.event_id === eventId)).toBe(true);
  });

  it("dlq inspection lists dead letters and hides replayed ones by default", async () => {
    await seedDeadLetter();
    const caller = eventsAdminRouter.createCaller(adminCtx());
    const before = await caller.dlq({ topic: TOPIC });
    expect(before.data.items.some((i) => i.event_id === EVENT_ID)).toBe(true);
    await caller.replay({ topic: TOPIC, source: "dlq" });
    const after = await caller.dlq({ topic: TOPIC });
    expect(after.data.items.some((i) => i.event_id === EVENT_ID)).toBe(false);
    const withReplayed = await caller.dlq({ topic: TOPIC, include_replayed: true });
    expect(
      withReplayed.data.items.some(
        (i) => i.event_id === EVENT_ID && i.replayed_at !== null,
      ),
    ).toBe(true);
  });

  it("requires a privileged role", async () => {
    const analystCtx: TrpcContext = {
      req: new Request("http://test.local/"),
      resHeaders: new Headers(),
      user: {
        ...(adminCtx().user as User),
        id: 999011,
        unionId: "replay-analyst",
        platformRole: "policy_analyst",
      },
    };
    const caller = eventsAdminRouter.createCaller(analystCtx);
    await expect(caller.replay({ topic: TOPIC })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller.dlq({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
