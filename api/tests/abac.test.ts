import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import type { TrpcContext } from "../context";
import type { User } from "@db/schema";

/** Jurisdiction-scoped authorization (ABAC) tests against seeded grants. */

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

describe("jurisdiction-scoped authorization (ABAC)", () => {
  it("forbids scenario creation outside the actor's assigned jurisdiction", async () => {
    const analyst = await demoUser("demo-policy-analyst"); // granted jur:ng-kd
    const caller = appRouter.createCaller(ctxFor(analyst));
    await expect(
      caller.scenarios.create({
        jurisdiction_id: "jur:ng-la", // Lagos — not granted
        name: "Cross-jurisdiction attempt",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows scenario creation within the assigned jurisdiction", async () => {
    const analyst = await demoUser("demo-policy-analyst");
    const caller = appRouter.createCaller(ctxFor(analyst));
    const res = await caller.scenarios.create({
      jurisdiction_id: "jur:ng-kd",
      name: `ABAC allowed scenario ${Date.now()}`,
    });
    expect(res.data?.scenarioId ?? (res.data as never as { scenario_id: string }).scenario_id).toBeTruthy();
  });

  it("executive/platform_admin bypass jurisdiction grants", async () => {
    const analyst = await demoUser("demo-policy-analyst");
    const admin: User = { ...analyst, id: 999001, platformRole: "platform_admin" };
    const caller = appRouter.createCaller(ctxFor(admin));
    const res = await caller.scenarios.create({
      jurisdiction_id: "jur:ng-la",
      name: `Admin bypass scenario ${Date.now()}`,
    });
    expect(res.data).toBeTruthy();
  });

  it("forbids brief generation outside the assigned jurisdiction", async () => {
    const analyst = await demoUser("demo-policy-analyst");
    const caller = appRouter.createCaller(ctxFor(analyst));
    await expect(
      caller.briefs.generate({
        jurisdiction_id: "jur:ng-kn", // Kano — not granted
        title: "Unauthorized brief attempt",
        idempotency_key: `abac-brief-${Date.now()}`,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("anonymous callers get UNAUTHORIZED before ABAC", async () => {
    const caller = appRouter.createCaller({
      req: new Request("http://test.local/"),
      resHeaders: new Headers(),
    });
    await expect(
      caller.scenarios.create({ jurisdiction_id: "jur:ng-la", name: "Anon attempt" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
