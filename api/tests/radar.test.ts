import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { amountFactor, impactScore } from "@contracts/radar";
import { registeredEventTopics, validateEventPayload } from "@contracts/events";
import { appRouter } from "../router";
import { POLICY_ALERT_TOPIC } from "../radar";
import { getDb } from "../queries/connection";
import type { TrpcContext } from "../context";
import type { User } from "@db/schema";

const db = getDb();

const TEST_DOC_ID = "doc:radar-test-bill-1";
const TEST_BUDGET_ID = "bud:radar-test-1";

beforeAll(async () => {
  // Fresh rows so the 7d scan window sees them (idempotent upsert by PK).
  const haveDoc = await db.query.policyDocuments.findFirst({
    where: eq(schema.policyDocuments.documentId, TEST_DOC_ID),
  });
  if (!haveDoc) {
    await db.insert(schema.policyDocuments).values({
      documentId: TEST_DOC_ID,
      title: "National Renewable Energy and Solar Power Bill 2025",
      jurisdictionId: "jur:ng",
      docType: "bill",
      origin: "seed",
    });
  }
  const haveBudget = await db.query.budgets.findFirst({
    where: eq(schema.budgets.budgetId, TEST_BUDGET_ID),
  });
  if (!haveBudget) {
    await db.insert(schema.budgets).values({
      budgetId: TEST_BUDGET_ID,
      jurisdictionId: "jur:ng",
      fiscalYear: 2026,
      mda: "Federal Ministry of Works — highway construction",
      sectorCode: "works",
      appropriatedNgn: 250_000_000_000,
      releasedNgn: 100_000_000_000,
      origin: "seed",
    });
  }
});

function anonCtx(): TrpcContext {
  return { req: new Request("http://test.local/"), resHeaders: new Headers() };
}

async function demoUser(unionId: string): Promise<User> {
  const user = await db.query.users.findFirst({
    where: eq(schema.users.unionId, unionId),
  });
  if (!user) throw new Error(`seed user ${unionId} missing — run db/seed.ts`);
  return user;
}

function ctxFor(user: User): TrpcContext {
  return { req: new Request("http://test.local/"), resHeaders: new Headers(), user };
}

describe("I1 — deterministic impact rubric", () => {
  it("amountFactor is log-scaled and clamped to [1,2]", () => {
    expect(amountFactor(null)).toBe(1.0);
    expect(amountFactor(0)).toBe(1.0);
    expect(amountFactor(1_000_000_000)).toBe(1.0);
    expect(amountFactor(1_000_000_000_000)).toBe(2.0);
    expect(amountFactor(10_000_000_000_000)).toBe(2.0);
  });

  it("impactScore is deterministic, sector-aware and bounded [0,100]", () => {
    const a = impactScore({ text: "solar energy bill", sourceEntity: "bill" });
    const b = impactScore({ text: "solar energy bill", sourceEntity: "bill" });
    expect(a).toEqual(b);
    expect(a.sector).toBe("energy");
    expect(a.score).toBeGreaterThan(0);
    expect(a.score).toBeLessThanOrEqual(100);
    // regulation outranks bill; amount magnitude raises the score.
    const reg = impactScore({ text: "solar energy bill", sourceEntity: "regulation" });
    expect(reg.score).toBeGreaterThan(a.score);
    const big = impactScore({
      text: "works budget",
      sourceEntity: "budget",
      appropriatedNgn: 1_000_000_000_000,
    });
    const small = impactScore({
      text: "works budget",
      sourceEntity: "budget",
      appropriatedNgn: 1_000_000,
    });
    expect(big.score).toBeGreaterThan(small.score);
  });
});

describe("I1 — radar.scan & radar.alerts", () => {
  it("policy.alert extension topic is registered with a payload schema", () => {
    expect(registeredEventTopics()).toContain(POLICY_ALERT_TOPIC);
    expect(
      validateEventPayload(POLICY_ALERT_TOPIC, { alert_id: "alert:bill:x" }).ok,
    ).toBe(true);
    expect(validateEventPayload(POLICY_ALERT_TOPIC, { alert_id: "" }).ok).toBe(false);
  });

  it("scan requires authentication and the policy_analyst role", async () => {
    const caller = appRouter.createCaller(anonCtx());
    await expect(caller.radar.scan({ days: 7 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    const legal = await demoUser("demo-legal-analyst");
    const caller2 = appRouter.createCaller(ctxFor(legal));
    await expect(caller2.radar.scan({ days: 7 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("policy_analyst scan inserts alerts and is idempotent on re-scan", { timeout: 120000 }, async () => {
    const analyst = await demoUser("demo-policy-analyst");
    const caller = appRouter.createCaller(ctxFor(analyst));
    // NOTE: alerts may already exist in the shared dev DB (parallel agents
    // run scans). So the first-scan assertion is relaxed to `inserted >= 0`
    // and idempotency is asserted on the delta: a second scan of the same
    // window must insert nothing new.
    const first = await caller.radar.scan({ days: 30 });
    expect(first.data.scanned).toBeGreaterThanOrEqual(2);
    expect(first.data.inserted).toBeGreaterThanOrEqual(0);
    const ids = first.data.alerts.map((a) => a.alertId);
    expect(ids).toContain(`alert:bill:${TEST_DOC_ID}`);
    expect(ids).toContain(`alert:budget:${TEST_BUDGET_ID}`);
    const second = await caller.radar.scan({ days: 30 });
    expect(second.data.inserted).toBe(0);
    expect(second.data.scanned).toBe(first.data.scanned);
  });

  it("alerts feed supports sector filter and validates against the contract", async () => {
    const caller = appRouter.createCaller(anonCtx());
    const all = await caller.radar.alerts({ limit: 100 });
    expect(all.data.alerts.length).toBeGreaterThanOrEqual(2);
    const energy = await caller.radar.alerts({ sector: "energy", limit: 100 });
    expect(energy.data.alerts.length).toBeGreaterThanOrEqual(1);
    for (const a of energy.data.alerts) expect(a.sector).toBe("energy");
    for (const a of all.data.alerts) {
      expect(a.impactScore).toBeGreaterThanOrEqual(0);
      expect(a.impactScore).toBeLessThanOrEqual(100);
      expect(["bill", "regulation", "budget"]).toContain(a.sourceEntity);
    }
  });

  it("alerts feed honors the since filter", async () => {
    const caller = appRouter.createCaller(anonCtx());
    const future = await caller.radar.alerts({
      since: new Date(Date.now() + 3600_000).toISOString(),
      limit: 100,
    });
    expect(future.data.alerts.length).toBe(0);
  });
});
