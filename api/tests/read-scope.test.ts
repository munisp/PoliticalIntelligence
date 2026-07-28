import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import type { TrpcContext } from "../context";
import type { User } from "@db/schema";

/**
 * Jurisdiction-scoped READ enforcement (SR-10 / SEC-3, gap 4).
 * Read procedures require sign-in and restrict non-global actors to their
 * assigned jurisdictions; executive/platform_admin are jurisdiction-global.
 */

async function demoUser(unionId: string): Promise<User> {
  const user = await getDb().query.users.findFirst({
    where: eq(schema.users.unionId, unionId),
  });
  if (!user) throw new Error(`seed user ${unionId} missing — run db/seed.ts`);
  return user;
}

function ctxFor(user: User): TrpcContext {
  return {
    req: new Request("http://test.local/"),
    resHeaders: new Headers(),
    user,
  };
}

const ANON: TrpcContext = {
  req: new Request("http://test.local/"),
  resHeaders: new Headers(),
};

describe("jurisdiction-scoped reads", () => {
  it("anonymous callers use the public facade tier (unscoped reference data)", async () => {
    const caller = appRouter.createCaller(ANON);
    // The public facade serves aggregate reference data without a session;
    // scoping engages as soon as an actor authenticates (next tests).
    const profile = await caller.jurisdictions.profile({ jurisdiction_id: "jur:ng-kd" });
    expect(profile.data.jurisdiction.jurisdictionId).toBe("jur:ng-kd");
    const rankings = await caller.opportunities.rankings({ jurisdiction_id: "jur:ng-kd" });
    expect(rankings.data.items.length).toBeGreaterThan(0);
    // jurisdictions.accessible is actor-specific: it requires auth.
    await expect(caller.jurisdictions.accessible()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("analyst scoped to jur:ng-kd gets 403 on jur:ng-la profile", async () => {
    const analyst = await demoUser("demo-policy-analyst"); // granted jur:ng-kd only
    const caller = appRouter.createCaller(ctxFor(analyst));
    await expect(
      caller.jurisdictions.profile({ jurisdiction_id: "jur:ng-la" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.jurisdictions.get({ jurisdiction_id: "jur:ng-la" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.jurisdictions.geoUnits({ jurisdiction_id: "jur:ng-la" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.sectors.metrics({ jurisdiction_id: "jur:ng-la" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("analyst CAN read the assigned jurisdiction profile", async () => {
    const analyst = await demoUser("demo-policy-analyst");
    const caller = appRouter.createCaller(ctxFor(analyst));
    const res = await caller.jurisdictions.profile({ jurisdiction_id: "jur:ng-kd" });
    expect(res.data.jurisdiction.jurisdictionId).toBe("jur:ng-kd");
  });

  it("rankings are filtered to the accessible set when no jurisdiction requested", async () => {
    const analyst = await demoUser("demo-policy-analyst");
    const caller = appRouter.createCaller(ctxFor(analyst));
    const res = await caller.opportunities.rankings({ limit: 50 });
    expect(res.data.items.length).toBeGreaterThan(0);
    for (const item of res.data.items) {
      expect(item.jurisdictionId).toBe("jur:ng-kd");
    }
  });

  it("rankings for a non-granted jurisdiction are 403", async () => {
    const analyst = await demoUser("demo-policy-analyst");
    const caller = appRouter.createCaller(ctxFor(analyst));
    await expect(
      caller.opportunities.rankings({ jurisdiction_id: "jur:ng-la" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("briefs list is filtered to accessible jurisdictions", async () => {
    const analyst = await demoUser("demo-policy-analyst");
    const caller = appRouter.createCaller(ctxFor(analyst));
    const res = await caller.briefs.list({ limit: 50 });
    for (const item of res.data.items) {
      expect(item.jurisdictionId).toBe("jur:ng-kd");
    }
  });

  it("legislation.laws is filtered to accessible jurisdictions", async () => {
    const analyst = await demoUser("demo-policy-analyst");
    const caller = appRouter.createCaller(ctxFor(analyst));
    const res = await caller.legislation.laws({ limit: 50 });
    for (const item of res.data.items) {
      expect(item.jurisdictionId).toBe("jur:ng-kd");
    }
  });

  it("jurisdictions.accessible reports assigned grants", async () => {
    const analyst = await demoUser("demo-policy-analyst");
    const caller = appRouter.createCaller(ctxFor(analyst));
    const res = await caller.jurisdictions.accessible();
    expect(res.data.scope).toBe("assigned");
    expect(res.data.jurisdiction_ids).toContain("jur:ng-kd");
  });

  it("jurisdictions.list is filtered for scoped actors", async () => {
    const analyst = await demoUser("demo-policy-analyst");
    const caller = appRouter.createCaller(ctxFor(analyst));
    const res = await caller.jurisdictions.list({ limit: 50 });
    expect(res.data.items.length).toBeGreaterThan(0);
    for (const item of res.data.items) {
      expect(item.jurisdictionId).toBe("jur:ng-kd");
    }
  });

  it("executive/platform_admin see all jurisdictions", async () => {
    const analyst = await demoUser("demo-policy-analyst");
    const exec: User = { ...analyst, id: 999002, platformRole: "executive" };
    const caller = appRouter.createCaller(ctxFor(exec));
    const accessible = await caller.jurisdictions.accessible();
    expect(accessible.data.scope).toBe("all");
    const res = await caller.jurisdictions.list({ limit: 100 });
    const ids = res.data.items.map((i) => i.jurisdictionId);
    expect(ids).toContain("jur:ng-kd");
    expect(ids).toContain("jur:ng-la");
    // And can read a non-analyst jurisdiction profile directly.
    const profile = await caller.jurisdictions.profile({ jurisdiction_id: "jur:ng-la" });
    expect(profile.data.jurisdiction.jurisdictionId).toBe("jur:ng-la");
  });
});
