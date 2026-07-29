import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { seedAdvocacy, ADVOCACY_STAKEHOLDERS } from "@db/seed-advocacy";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import type { TrpcContext } from "../context";
import type { User } from "@db/schema";

const db = getDb();
const STK = ADVOCACY_STAKEHOLDERS[0].stakeholderId;

beforeAll(async () => {
  await seedAdvocacy();
}, 60000);

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

describe("I5 — advocacy CRM", () => {
  it("CRM procedures require authentication", async () => {
    const caller = appRouter.createCaller(anonCtx());
    await expect(
      caller.advocacy.logEngagement({ stakeholderId: STK, channel: "meeting" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      caller.advocacy.engagements({ stakeholderId: STK }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.advocacy.upcomingActions()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("logEngagement validates the stakeholder and writes an audited row", async () => {
    const analyst = await demoUser("demo-policy-analyst");
    const caller = appRouter.createCaller(ctxFor(analyst));
    await expect(
      caller.advocacy.logEngagement({ stakeholderId: "stk:no-such", channel: "call" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const res = await caller.advocacy.logEngagement({
      stakeholderId: STK,
      channel: "roundtable",
      outcome: "Agreed to table the amendment in committee.",
      commitments: "Share fiscal note by Friday.",
      nextAction: "Send fiscal note",
      nextActionDate: "2026-02-15",
    });
    expect(res.data.engagement.stakeholderId).toBe(STK);
    expect(res.data.engagement.channel).toBe("roundtable");
    expect(res.data.engagement.userId).toBe(analyst.id);
    expect(res.data.engagement.nextActionDate).toBe("2026-02-15");
  });

  it("engagements are own-user scoped (other users see an empty history)", async () => {
    const analyst = await demoUser("demo-policy-analyst");
    const legal = await demoUser("demo-legal-analyst");
    const mine = await appRouter
      .createCaller(ctxFor(analyst))
      .advocacy.engagements({ stakeholderId: STK });
    expect(mine.data.engagements.length).toBeGreaterThanOrEqual(1);
    expect(
      mine.data.engagements.every((e) => e.userId === analyst.id),
    ).toBe(true);
    const theirs = await appRouter
      .createCaller(ctxFor(legal))
      .advocacy.engagements({ stakeholderId: STK });
    expect(
      theirs.data.engagements.every((e) => e.userId === legal.id),
    ).toBe(true);
    // Legal analyst never logged for STK → empty (or only their own rows).
    expect(
      theirs.data.engagements.some((e) => e.userId === analyst.id),
    ).toBe(false);
  });

  it("upcomingActions returns dated next actions with daysUntil, soonest first", async () => {
    const analyst = await demoUser("demo-policy-analyst");
    const caller = appRouter.createCaller(ctxFor(analyst));
    const res = await caller.advocacy.upcomingActions();
    expect(res.data.actions.length).toBeGreaterThanOrEqual(1);
    const a = res.data.actions[0];
    expect(a.nextAction).toBeTruthy();
    expect(a.nextActionDate).toBeTruthy();
    expect(typeof a.daysUntil).toBe("number");
    expect(a.stakeholderName).toBeTruthy();
    const days = res.data.actions.map((x) => x.daysUntil ?? 0);
    expect([...days].sort((x, y) => x - y)).toEqual(days);
  });

  it("engagement history is newest-first and limit-bounded", async () => {
    const analyst = await demoUser("demo-policy-analyst");
    const caller = appRouter.createCaller(ctxFor(analyst));
    await caller.advocacy.logEngagement({
      stakeholderId: STK,
      channel: "email",
      engagedAt: "2026-01-05T10:00:00Z",
      outcome: "Second touchpoint.",
    });
    const res = await caller.advocacy.engagements({ stakeholderId: STK, limit: 1 });
    expect(res.data.engagements.length).toBe(1);
    const full = await caller.advocacy.engagements({ stakeholderId: STK });
    const times = full.data.engagements.map((e) =>
      new Date(e.engagedAt).getTime(),
    );
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });
});
