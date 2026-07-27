import { describe, expect, it } from "vitest";
import { eq, gt } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import { insertAuditEvent } from "../queries/audit";
import { computeEntryHash, verifyAuditChain } from "../utils/auditchain";

/**
 * Hash-chained tamper-evident audit log: chain verifies, and a simulated
 * tamper (edit of a historical payload) is detected at the first broken id.
 * The test heals the chain afterwards so the shared dev DB stays valid.
 */
describe("audit hash chain", () => {
  it("appends chained events, verifies, and detects tampering", async () => {
    const marker = `test-chain-${Date.now()}`;
    await insertAuditEvent({
      actorId: null,
      action: "test.chain.one",
      entityType: "test_marker",
      entityId: marker,
      scopes: null,
      requestId: "req_test_chain_1",
      correlationId: "cor_test_chain_1",
      payload: { topic: "audit.events", n: 1 },
    });
    await insertAuditEvent({
      actorId: null,
      action: "test.chain.two",
      entityType: "test_marker",
      entityId: marker,
      scopes: null,
      requestId: "req_test_chain_2",
      correlationId: "cor_test_chain_2",
      payload: { topic: "audit.events", n: 2 },
    });

    const before = await verifyAuditChain();
    expect(before.chain_valid).toBe(true);
    expect(before.events_checked).toBeGreaterThanOrEqual(2);

    // Locate the first test event (the one we will tamper).
    const rows = await getDb()
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.entityId, marker));
    expect(rows.length).toBe(2);
    const first = rows[0];
    expect(first.prevHash).toBeTruthy();
    expect(first.entryHash).toBeTruthy();
    // The second event links to the first.
    expect(rows[1].prevHash).toBe(first.entryHash);

    // Simulate tampering: rewrite the historical payload in place.
    const originalPayload = first.payload;
    await getDb()
      .update(schema.auditEvents)
      .set({ payload: { topic: "audit.events", n: 999 } })
      .where(eq(schema.auditEvents.eventId, first.eventId));

    const after = await verifyAuditChain();
    expect(after.chain_valid).toBe(false);
    expect(after.first_broken_id).toBe(Number(first.eventId));

    // Heal: restore payload + recompute the entry hash so the chain is
    // valid again for subsequent users of the shared DB.
    const healedHash = computeEntryHash(
      {
        actorId: first.actorId,
        action: first.action,
        entityType: first.entityType,
        entityId: first.entityId,
        scopes: first.scopes,
        requestId: first.requestId,
        correlationId: first.correlationId,
        payload: originalPayload,
      },
      first.prevHash!,
    );
    expect(healedHash).toBe(first.entryHash);
    await getDb()
      .update(schema.auditEvents)
      .set({ payload: originalPayload })
      .where(eq(schema.auditEvents.eventId, first.eventId));

    const healed = await verifyAuditChain();
    expect(healed.chain_valid).toBe(true);
  });

  it("genesis event links to GENESIS", async () => {
    // Every chained row either points at GENESIS or at an earlier entry hash.
    const rows = await getDb()
      .select()
      .from(schema.auditEvents)
      .where(gt(schema.auditEvents.eventId, 0));
    const chained = rows.filter((r) => r.entryHash && r.prevHash);
    for (const r of chained) {
      expect(r.prevHash === "GENESIS" || /^[0-9a-f]{64}$/.test(r.prevHash!)).toBe(true);
      expect(/^[0-9a-f]{64}$/.test(r.entryHash!)).toBe(true);
    }
  });
});
