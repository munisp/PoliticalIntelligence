import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import type { TrpcContext } from "../context";
import type { User } from "@db/schema";
import { ROLE_SCOPES } from "../auth-router";
import app from "../boot";

/**
 * Coverage for the v4 backend finish: auth.permissions scopes, REST
 * auth/sectors/briefs/legislation-compare routes (envelope shape), uniform
 * Idempotency-Key enforcement (400), legislation.compare determinism, and
 * the healthz DB readiness probe (up path; down path is mocked in
 * healthz-down.test.ts).
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

describe("auth.permissions", () => {
  it("returns role, scopes and accessible jurisdictions for a policy analyst", async () => {
    const analyst = await demoUser("demo-policy-analyst");
    const caller = appRouter.createCaller(ctxFor(analyst));
    const res = await caller.auth.permissions();
    expect(res.data.role).toBe("policy_analyst");
    expect(res.data.scopes).toEqual(ROLE_SCOPES.policy_analyst);
    expect(res.data.scopes).toContain("briefs:generate");
    expect(res.data.jurisdictions).toEqual(["jur:ng-kd"]);
    expect(res.meta.request_id).toMatch(/^req_/);
  });

  it("executive (owner/admin) is jurisdiction-global with signoff scope", async () => {
    const owner = {
      id: 999999,
      role: "admin",
      platformRole: null,
    } as unknown as User;
    const caller = appRouter.createCaller(ctxFor(owner));
    const res = await caller.auth.permissions();
    expect(res.data.role).toBe("executive");
    expect(res.data.scopes).toEqual(["read:all", "signoff"]);
    expect(res.data.jurisdictions).toBe("all");
  });

  it("covers every platform role in ROLE_SCOPES", () => {
    expect(Object.keys(ROLE_SCOPES).sort()).toEqual(
      [
        "executive",
        "policy_analyst",
        "legal_analyst",
        "simulation_specialist",
        "data_steward",
        "field_officer",
        "platform_admin",
      ].sort(),
    );
  });
});

describe("legislation.compare", () => {
  const input = {
    law_id_a: "law:ng:ppa-2007",
    law_id_b: "law:ng-kd:procurement-law",
  };

  it("aligns clauses deterministically (same engine as innovations.policyDiff)", async () => {
    const caller = appRouter.createCaller({
      req: new Request("http://test.local/"),
      resHeaders: new Headers(),
    });
    const res = await caller.legislation.compare(input);
    expect(res.data.law_id_a).toBe(input.law_id_a);
    expect(res.data.law_id_b).toBe(input.law_id_b);
    expect(res.data.aligned.length + res.data.unique_clauses.length).toBeGreaterThan(0);
    for (const a of res.data.aligned) {
      expect(a.similarity).toBeGreaterThanOrEqual(0.35);
    }
    const again = await caller.legislation.compare(input);
    expect(again.data).toEqual(res.data); // deterministic
    // Same underlying engine as innovations.policyDiff.
    const viaInnovations = await caller.innovations.policyDiff(input);
    expect(viaInnovations.data).toEqual(res.data);
  });

  it("404 error for a missing law", async () => {
    const caller = appRouter.createCaller({
      req: new Request("http://test.local/"),
      resHeaders: new Headers(),
    });
    await expect(
      caller.legislation.compare({ ...input, law_id_b: "law:nope:missing" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("REST /v1 new routes + uniform idempotency", () => {
  it("GET /v1/sectors returns the standard envelope", async () => {
    const res = await app.request("/v1/sectors");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta.api_version).toBe("v1");
    expect(body.meta.request_id).toMatch(/^req_/);
  });

  it("GET /v1/auth/me anonymous → 401 error envelope", async () => {
    const res = await app.request("/v1/auth/me");
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.retryable).toBe(false);
  });

  it("GET /v1/auth/permissions anonymous → 401 error envelope", async () => {
    const res = await app.request("/v1/auth/permissions");
    expect(res.status).toBe(401);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("GET /v1/briefs/:id missing brief → 404 error envelope", async () => {
    const res = await app.request("/v1/briefs/brf:does-not-exist");
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("BRIEF_NOT_FOUND");
  });

  it("POST /v1/legislation/compare returns alignment in the standard envelope", async () => {
    const res = await app.request("/v1/legislation/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        law_id_a: "law:ng:ppa-2007",
        law_id_b: "law:ng-kd:procurement-law",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.law_id_a).toBe("law:ng:ppa-2007");
    expect(Array.isArray(body.data.aligned)).toBe(true);
    expect(Array.isArray(body.data.gap_clauses)).toBe(true);
    expect(body.meta.request_id).toMatch(/^req_/);
  });

  it("POST /v1/scenarios without Idempotency-Key → 400 IDEMPOTENCY_KEY_REQUIRED", async () => {
    const res = await app.request("/v1/scenarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jurisdiction_id: "jur:ng-kd", name: "No key scenario" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect(body.error.retryable).toBe(false);
  });

  it("POST /v1/scenarios/:id/runs without Idempotency-Key → 400", async () => {
    const res = await app.request("/v1/scenarios/scn:demo/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("POST /v1/briefs without Idempotency-Key → 400", async () => {
    const res = await app.request("/v1/briefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jurisdiction_id: "jur:ng-kd", title: "No key brief" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("POST /v1/opportunities/generate without Idempotency-Key → 400", async () => {
    const res = await app.request("/v1/opportunities/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ opportunity_id: "opp:edu:digital-classroom-assistants" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });
});

describe("healthz readiness probe", () => {
  it("GET /healthz returns 200 with db up", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("ok");
    expect(body.db).toBe("up");
  });
});
