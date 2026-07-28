import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "@db/schema";
import { EventTopics } from "@contracts/entities";
import {
  EventPayloadSchemas,
  validateEventPayload,
} from "@contracts/events";
import { getDb } from "../queries/connection";
import { emitEvent } from "../utils/events";

/**
 * API-8 event schema pack: per-topic zod payload schemas registered for the
 * whole catalog and enforced on emit (invalid payloads dropped, never
 * persisted to the outbox).
 */
describe("event schema pack (API-8)", () => {
  it("every catalog topic has a registered payload schema", () => {
    for (const topic of Object.values(EventTopics)) {
      expect(
        (EventPayloadSchemas as Record<string, unknown>)[topic],
        `missing schema for ${topic}`,
      ).toBeDefined();
    }
  });

  it("accepts the payloads current producers emit", () => {
    const fixtures: [string, unknown][] = [
      // emitJobLifecycle (queued -> scenarios.run.requested)
      [EventTopics.scenariosRunRequested, { job_id: "job:1", type: "simulations.run", status: "queued" }],
      // runner.ts simulation completion
      [EventTopics.simulationsRunCompleted, { simulation_run_id: "run:1", scenario_id: "scn:1", engine: "ces", bridge: "local", seed: 42 }],
      // runner.ts backtest completion
      [EventTopics.simulationsRunCompleted, { backtest: true, scenario_id: "scn:1", engine: "ces", mape: 12.34 }],
      // emitJobLifecycle (succeeded -> recommendations/reports)
      [EventTopics.recommendationsGenerated, { job_id: "job:2", type: "opportunities.generate", status: "succeeded" }],
      [EventTopics.reportsGenerated, { job_id: "job:3", type: "briefs.generate", status: "succeeded" }],
      // consumers.ts stuck-job sweeper + webhook ping
      [EventTopics.opsAlerts, { job_id: "job:4", type: "simulations.run", reason: "stuck-job-auto-failed" }],
      [EventTopics.opsAlerts, { type: "ping", sub_id: "sub:x", ts: "2026-01-01T00:00:00Z" }],
      // runner.ts recalibration -> features.materialized
      [EventTopics.featuresMaterialized, { recalibration: true, jurisdiction_id: "jur:ng-kd", layers: 3 }],
      // ingest connector payload
      [EventTopics.ingestRawReceived, { source_id: "src:nbs", object_uri: "s3://bucket/key", checksum: "abc123" }],
    ];
    for (const [topic, payload] of fixtures) {
      const v = validateEventPayload(topic, payload);
      expect(v.ok, `${topic} fixture rejected: ${v.ok ? "" : v.error}`).toBe(true);
    }
  });

  it("rejects malformed payloads", () => {
    // wrong type for a documented field
    expect(validateEventPayload(EventTopics.simulationsRunCompleted, { mape: "high" }).ok).toBe(false);
    // missing required field
    expect(validateEventPayload(EventTopics.ingestRawReceived, { object_uri: "s3://x" }).ok).toBe(false);
    expect(validateEventPayload(EventTopics.scenariosRunRequested, { status: "queued" }).ok).toBe(false);
    // non-object payload
    expect(validateEventPayload(EventTopics.opsAlerts, "alert").ok).toBe(false);
    expect(validateEventPayload(EventTopics.opsAlerts, null).ok).toBe(false);
    // unregistered topic
    expect(validateEventPayload("no.such.topic", {}).ok).toBe(false);
  });

  it("emitEvent drops schema-violating payloads before the outbox", async () => {
    const marker = `schema-drop-${Date.now()}`;
    const before = await getDb().execute(
      sql`SELECT COUNT(*) AS n FROM event_outbox WHERE topic = 'ops.alerts'`,
    );
    const nBefore = Number((before as unknown as [{ n: number }[]])[0][0].n);
    await emitEvent(EventTopics.opsAlerts, { job_id: 12345, note: marker }); // job_id must be string
    const after = await getDb().execute(
      sql`SELECT COUNT(*) AS n FROM event_outbox WHERE topic = 'ops.alerts'`,
    );
    const nAfter = Number((after as unknown as [{ n: number }[]])[0][0].n);
    expect(nAfter).toBe(nBefore);
    // sanity: a valid payload on the same topic does reach the outbox
    await emitEvent(EventTopics.opsAlerts, { type: "schema-probe", note: marker });
    const rows = await getDb()
      .select()
      .from(schema.eventOutbox)
      .where(eq(schema.eventOutbox.topic, "ops.alerts"));
    expect(
      rows.some((r) => JSON.stringify(r.payload).includes(marker)),
    ).toBe(true);
  });
});
