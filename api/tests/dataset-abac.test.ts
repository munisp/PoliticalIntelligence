import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
import * as schema from "@db/schema";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import type { TrpcContext } from "../context";
import type { User } from "@db/schema";

/**
 * SEC-3: dataset/document-level ABAC. Each enforcement point is exercised
 * with an exact-dataset restricted policy: documents.list (hidden),
 * documents.get (403), legislation.clauses (403), opportunities.get (403),
 * admin.dataSources (hidden). Public and internal classes are covered too.
 */

const ANON: TrpcContext = {
  req: new Request("http://test.local/"),
  resHeaders: new Headers(),
};

async function demoUser(unionId: string): Promise<User> {
  const user = await getDb().query.users.findFirst({
    where: eq(schema.users.unionId, unionId),
  });
  if (!user) throw new Error(`seed user ${unionId} missing — run db/seed.ts`);
  return user;
}

function ctxFor(user: User): TrpcContext {
  return { req: new Request("http://test.local/"), resHeaders: new Headers(), user };
}

async function upsertPolicy(p: typeof schema.datasetPolicies.$inferInsert) {
  await getDb()
    .insert(schema.datasetPolicies)
    .values(p)
    .onDuplicateKeyUpdate({
      set: {
        classification: p.classification,
        allowedRoles: p.allowedRoles,
        jurisdictionId: p.jurisdictionId ?? null,
      },
    });
}

// Hermetic fixtures: this suite inserts its own rows with unique
// `abac-test-` ids so concurrent suites (e.g. drafting tests inserting
// laws) can never shift which row `findFirst()` would return.
const docId = "abac-test-doc";
const lawId = "abac-test-law";
const oppId = "abac-test-opp";
const sourceId = "abac-test-source";

/** Self-contained data-steward user with a jur:ng-kd read grant. */
async function ensureSteward(): Promise<User> {
  const db = getDb();
  let user = await db.query.users.findFirst({
    where: eq(schema.users.unionId, "dsteward-abac-test"),
  });
  if (!user) {
    await db.insert(schema.users).values({
      unionId: "dsteward-abac-test",
      name: "ABAC Test Steward",
      email: "dsteward@example.test",
      role: "user",
      platformRole: "data_steward",
    } as never);
    user = await db.query.users.findFirst({
      where: eq(schema.users.unionId, "dsteward-abac-test"),
    });
  }
  await db.insert(schema.userJurisdictions).values({
    userId: user!.id,
    jurisdictionId: "jur:ng-kd",
    accessLevel: "read",
  } as never).onDuplicateKeyUpdate({ set: { accessLevel: "read" } });
  return user!;
}

beforeAll(async () => {
  const db = getDb();
  // Insert dedicated entities pinned to jur:ng-kd (the jurisdiction the
  // steward below is granted read access to).
  await db
    .insert(schema.policyDocuments)
    .values({
      documentId: docId,
      title: "ABAC Test Document",
      jurisdictionId: "jur:ng-kd",
      language: "en",
    } as never)
    .onDuplicateKeyUpdate({ set: { title: "ABAC Test Document" } });
  await db
    .insert(schema.laws)
    .values({
      lawId,
      title: "ABAC Test Law",
      jurisdictionId: "jur:ng-kd",
      status: "in_force",
    } as never)
    .onDuplicateKeyUpdate({ set: { title: "ABAC Test Law" } });
  await db
    .insert(schema.opportunities)
    .values({
      opportunityId: oppId,
      jurisdictionId: "jur:ng-kd",
      sectorCode: "abac-test",
      title: "ABAC Test Opportunity",
    } as never)
    .onDuplicateKeyUpdate({ set: { title: "ABAC Test Opportunity" } });
  await db
    .insert(schema.dataSources)
    .values({
      sourceId,
      name: "ABAC Test Source",
    } as never)
    .onDuplicateKeyUpdate({ set: { name: "ABAC Test Source" } });

  // Restricted policies pinned to jur:ng-kd, allowed roles: data_steward.
  for (const [entityType, datasetId] of [
    ["document", docId],
    ["clause", lawId],
    ["opportunity", oppId],
    ["data_source", sourceId],
  ] as const) {
    await upsertPolicy({
      policyId: `pol:test:${entityType}`,
      datasetId,
      entityType,
      classification: "restricted",
      allowedRoles: ["data_steward", "platform_admin"],
      jurisdictionId: "jur:ng-kd",
    });
  }
  // An internal-class dataset (authenticated users only).
  await upsertPolicy({
    policyId: "pol:test:internal-doc",
    datasetId: "doc:test-internal",
    entityType: "document",
    classification: "internal",
    allowedRoles: null,
    jurisdictionId: null,
  });
  // A public-class dataset (anonymous allowed).
  await upsertPolicy({
    policyId: "pol:test:public-doc",
    datasetId: "doc:test-public",
    entityType: "document",
    classification: "public",
    allowedRoles: null,
    jurisdictionId: null,
  });
});

describe("dataset-level ABAC (SEC-3)", () => {
  it("documents.list hides restricted documents; meta counts them", async () => {
    const caller = appRouter.createCaller(ANON);
    const res = await caller.documents.list({ limit: 100 });
    const ids = (res.data.items as any[]).map((d) => d.documentId);
    expect(ids).not.toContain(docId);
    expect(res.data.restricted_hidden).toBeGreaterThanOrEqual(1);
  });

  it("documents.get forbids anonymous and wrong-role actors on restricted docs", async () => {
    await expect(
      appRouter.createCaller(ANON).documents.get({ document_id: docId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const analyst = await demoUser("demo-policy-analyst"); // role not in allowed_roles
    await expect(
      appRouter.createCaller(ctxFor(analyst)).documents.get({ document_id: docId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("documents.get allows an allowed role with jurisdiction access", async () => {
    const steward = await ensureSteward();
    const res = await appRouter
      .createCaller(ctxFor(steward))
      .documents.get({ document_id: docId });
    expect(res.data.documentId).toBe(docId);
  });

  it("legislation.clauses forbids restricted instruments", async () => {
    await expect(
      appRouter.createCaller(ANON).legislation.clauses({ law_id: lawId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const steward = await ensureSteward();
    const res = await appRouter
      .createCaller(ctxFor(steward))
      .legislation.clauses({ law_id: lawId });
    expect(Array.isArray(res.data)).toBe(true);
  });

  it("opportunities.get forbids restricted datasets", async () => {
    await expect(
      appRouter.createCaller(ANON).opportunities.get({ opportunity_id: oppId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin.dataSources hides restricted sources for unauthorized roles", async () => {
    const steward = await ensureSteward(); // allowed → visible
    const visible = await appRouter
      .createCaller(ctxFor(steward))
      .admin.dataSources({});
    expect((visible.data as any[]).map((s) => s.sourceId)).toContain(sourceId);

    // Make a second policy allowing only platform_admin, then a data
    // steward must NOT see that source.
    await upsertPolicy({
      policyId: "pol:test:source-admin-only",
      datasetId: sourceId,
      entityType: "data_source",
      classification: "restricted",
      allowedRoles: ["platform_admin"],
      jurisdictionId: null,
    });
    const hidden = await appRouter
      .createCaller(ctxFor(steward))
      .admin.dataSources({});
    expect((hidden.data as any[]).map((s) => s.sourceId)).not.toContain(sourceId);
    expect((hidden.meta as any).restricted_hidden).toBeGreaterThanOrEqual(1);
    // Restore the shared policy for other tests.
    await upsertPolicy({
      policyId: "pol:test:data_source",
      datasetId: sourceId,
      entityType: "data_source",
      classification: "restricted",
      allowedRoles: ["data_steward", "platform_admin"],
      jurisdictionId: "jur:ng-kd",
    });
  });

  it("internal datasets require a session; public datasets are open", async () => {
    const { canReadDataset } = await import("../utils/datasets");
    expect(
      await canReadDataset(ANON, {
        entityType: "document",
        datasetId: "doc:test-internal",
      }),
    ).toBe(false);
    expect(
      await canReadDataset(ANON, {
        entityType: "document",
        datasetId: "doc:test-public",
      }),
    ).toBe(true);
    const analyst = await demoUser("demo-policy-analyst");
    expect(
      await canReadDataset(ctxFor(analyst), {
        entityType: "document",
        datasetId: "doc:test-internal",
      }),
    ).toBe(true);
    // No policy ⇒ default-open platform reference data.
    expect(
      await canReadDataset(ANON, {
        entityType: "document",
        datasetId: "doc:unclassified",
      }),
    ).toBe(true);
  });

async function cleanup() {
  const db = getDb();
  // Remove all policies this suite created (pol:test:*), then the inserted
  // entities, then the steward's jurisdiction grant (the user may stay).
  await db
    .delete(schema.datasetPolicies)
    .where(like(schema.datasetPolicies.policyId, "pol:test:%"));
  await db
    .delete(schema.policyDocuments)
    .where(eq(schema.policyDocuments.documentId, docId));
  await db.delete(schema.laws).where(eq(schema.laws.lawId, lawId));
  await db
    .delete(schema.opportunities)
    .where(eq(schema.opportunities.opportunityId, oppId));
  await db
    .delete(schema.dataSources)
    .where(eq(schema.dataSources.sourceId, sourceId));
  const steward = await db.query.users.findFirst({
    where: eq(schema.users.unionId, "dsteward-abac-test"),
  });
  if (steward) {
    await db
      .delete(schema.userJurisdictions)
      .where(eq(schema.userJurisdictions.userId, steward.id));
  }
}

afterAll(cleanup);

  it("restricted policy with jurisdiction pin denies actors without a grant", async () => {
    // policy pinned to jur:ng-la; demo-data-steward has a grant for
    // jur:ng-kd only (per read-scope tests) — but is in allowed_roles.
    await upsertPolicy({
      policyId: "pol:test:la-only",
      datasetId: "doc:test-la",
      entityType: "document",
      classification: "restricted",
      allowedRoles: ["data_steward"],
      jurisdictionId: "jur:ng-la",
    });
    const { canReadDataset } = await import("../utils/datasets");
    const steward = await ensureSteward();
    expect(
      await canReadDataset(ctxFor(steward), {
        entityType: "document",
        datasetId: "doc:test-la",
      }),
    ).toBe(false);
    // A non-listed role is denied even without the jurisdiction check.
    const analyst = await demoUser("demo-policy-analyst");
    expect(
      await canReadDataset(ctxFor(analyst), {
        entityType: "document",
        datasetId: "doc:test-la",
      }),
    ).toBe(false);
  });
});
