import { beforeAll, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import * as schema from "@db/schema";
import {
  analyzeIdeaOutput,
  pathwayDetailSchema,
  stakeholderMapOutput,
} from "@contracts/advocacy";
import {
  seedAdvocacy,
  ADVOCACY_STAKEHOLDERS,
  ADVOCACY_EDGES,
  ADVOCACY_PATHWAYS,
  ADVOCACY_CONTACT_NOTE,
} from "@db/seed-advocacy";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import type { TrpcContext } from "../context";
import type { User } from "@db/schema";

const db = getDb();

beforeAll(async () => {
  await seedAdvocacy();
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

describe("advocacy schema & seed", () => {
  it("advocacy tables exist and are populated", async () => {
    const stks = await db.select().from(schema.stakeholders);
    const edges = await db.select().from(schema.stakeholderEdges);
    const pws = await db.select().from(schema.regulatoryPathways);
    expect(stks.length).toBeGreaterThanOrEqual(45);
    expect(edges.length).toBeGreaterThanOrEqual(40);
    expect(pws.length).toBeGreaterThanOrEqual(2);
  });

  it("seed is idempotent (re-run keeps row counts)", async () => {
    const before = (await db.select().from(schema.stakeholders)).length;
    await seedAdvocacy();
    expect((await db.select().from(schema.stakeholders)).length).toBe(before);
  });

  it("all stakeholders are origin=derived, asOf-stamped, with public contact note", async () => {
    const rows = await db.select().from(schema.stakeholders);
    for (const r of rows) {
      expect(r.origin, r.stakeholderId).toBe("derived");
      expect(r.asOf, r.stakeholderId).toBe("2025-12");
      expect(r.contactNote, r.stakeholderId).toBe(ADVOCACY_CONTACT_NOTE);
    }
  });

  it("stakeholder graph integrity: every edge endpoint is an existing node", async () => {
    const rows = await db.select().from(schema.stakeholders);
    const ids = new Set(rows.map((r) => r.stakeholderId));
    for (const e of ADVOCACY_EDGES) {
      expect(ids.has(e.fromId), `edge from ${e.fromId}`).toBe(true);
      expect(ids.has(e.toId), `edge to ${e.toId}`).toBe(true);
    }
    // Seeded arrays are coherent with the DB.
    expect(ADVOCACY_STAKEHOLDERS.length).toBeGreaterThanOrEqual(45);
    expect(ADVOCACY_PATHWAYS.map((p) => p.pathwayId)).toContain(
      "pw:ng-fintech-tourism-payments",
    );
  });

  it("pathway associationRefs point at existing stakeholders", async () => {
    const rows = await db.select().from(schema.stakeholders);
    const ids = new Set(rows.map((r) => r.stakeholderId));
    for (const pw of ADVOCACY_PATHWAYS) {
      for (const ref of (pw.associationRefs as string[]) ?? []) {
        expect(ids.has(ref), `${pw.pathwayId} ref ${ref}`).toBe(true);
      }
    }
  });
});

describe("advocacy router", () => {
  it("listPathways is public and returns summaries", async () => {
    const caller = appRouter.createCaller(anonCtx());
    const res = await caller.advocacy.listPathways();
    expect(res.data.pathways.length).toBeGreaterThanOrEqual(2);
    const ids = res.data.pathways.map((p) => p.pathwayId);
    expect(ids).toContain("pw:ng-fintech-tourism-payments");
    expect(ids).toContain("pw:ng-land-management-platform");
  });

  it("getPathway returns the full detail matching its zod contract", async () => {
    const caller = appRouter.createCaller(anonCtx());
    const res = await caller.advocacy.getPathway({
      pathwayId: "pw:ng-fintech-tourism-payments",
    });
    const parsed = pathwayDetailSchema.safeParse(res.data.pathway);
    expect(parsed.success).toBe(true);
    expect(res.data.pathway.licenses.length).toBeGreaterThanOrEqual(5);
    expect(res.data.pathway.steps.length).toBeGreaterThanOrEqual(5);
    expect(
      res.data.pathway.supportingLawRefs.some((l) => l.title.includes("BOFIA")),
    ).toBe(true);
  });

  it("stakeholderMap filtered by pathway includes 1-hop neighbours and validates", async () => {
    const caller = appRouter.createCaller(anonCtx());
    const res = await caller.advocacy.stakeholderMap({
      pathwayId: "pw:ng-land-management-platform",
    });
    const parsed = stakeholderMapOutput.safeParse(res.data);
    expect(parsed.success).toBe(true);
    const nodeIds = new Set(res.data.nodes.map((n) => n.stakeholderId));
    // Seeded associations present.
    expect(nodeIds.has("stk:niesv")).toBe(true);
    // 1-hop neighbour: Lagos lands committee (lobbied by NIESV).
    expect(nodeIds.has("stk:lagos-assembly-lands-cte")).toBe(true);
    for (const e of res.data.edges) {
      expect(nodeIds.has(e.fromId)).toBe(true);
      expect(nodeIds.has(e.toId)).toBe(true);
    }
  });

  it("pathwayChecklist returns ordered steps with owners", async () => {
    const caller = appRouter.createCaller(anonCtx());
    const res = await caller.advocacy.pathwayChecklist({
      pathwayId: "pw:ng-land-management-platform",
    });
    expect(res.data.steps.length).toBeGreaterThanOrEqual(5);
    expect(res.data.steps[0].step).toBe("1");
    for (const s of res.data.steps) expect(s.owner.length).toBeGreaterThan(0);
  });

  it("analyzeIdea matches the fintech pathway and validates against the contract", async () => {
    const analyst = await demoUser("demo-policy-analyst");
    const caller = appRouter.createCaller(ctxFor(analyst));
    const res = await caller.advocacy.analyzeIdea({
      title: "Tourism payments wallet",
      description:
        "A payment platform for hotels and tour operators to accept card and transfer payments from tourists, with NIBSS settlement.",
      sector: "fintech",
      jurisdictionScope: "both",
    });
    const parsed = analyzeIdeaOutput.safeParse(res.data);
    expect(parsed.success).toBe(true);
    expect(res.data.meta.analysis_mode).toBe("rule_based");
    expect(res.data.matchedPathways[0]?.pathwayId).toBe(
      "pw:ng-fintech-tourism-payments",
    );
    for (const m of res.data.matchedPathways) {
      expect(m.fitScore).toBeGreaterThan(0);
      expect(m.fitScore).toBeLessThanOrEqual(1);
    }
    expect(res.data.recommendedStakeholders.length).toBeGreaterThan(0);
  });

  it("analyzeIdea is role-gated: anonymous UNAUTHORIZED, unprivileged role FORBIDDEN", async () => {
    const anon = appRouter.createCaller(anonCtx());
    await expect(
      anon.advocacy.analyzeIdea({
        title: "Land registry digitization",
        description: "Digitize state land registries with GIS and NIN identity.",
        sector: "land",
        jurisdictionScope: "state",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const analyst = await demoUser("demo-policy-analyst");
    const stewardless: User = {
      ...analyst,
      id: 999002,
      platformRole: "simulation_specialist",
    };
    const caller = appRouter.createCaller(ctxFor(stewardless));
    await expect(
      caller.advocacy.analyzeIdea({
        title: "Land registry digitization",
        description: "Digitize state land registries with GIS and NIN identity.",
        sector: "land",
        jurisdictionScope: "state",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("analyzeIdea writes an audit event", async () => {
    const analyst = await demoUser("demo-policy-analyst");
    const caller = appRouter.createCaller(ctxFor(analyst));
    await caller.advocacy.analyzeIdea({
      title: "Audit probe idea",
      description: "Fintech tourism payments compliance audit trail probe.",
      sector: "fintech",
      jurisdictionScope: "federal",
    });
    // audit() is fire-and-forget; poll briefly.
    let found: schema.AuditEvent | undefined;
    for (let i = 0; i < 10 && !found; i++) {
      await new Promise((r) => setTimeout(r, 150));
      found = await db.query.auditEvents.findFirst({
        where: eq(schema.auditEvents.action, "advocacy.analyze_idea"),
        orderBy: [desc(schema.auditEvents.eventId)],
      });
    }
    expect(found).toBeDefined();
    expect(found!.entityType).toBe("advocacy_analysis");
  });
});
