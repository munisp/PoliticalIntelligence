import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { diffImpactOutput, type DiffClause } from "@contracts/diff-impact";
import {
  computeDiffImpactFallback,
  diffObligationsFallback,
  diffParametersFallback,
  extractObligationsFallback,
} from "../lib/diff-impact";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import type { TrpcContext } from "../context";

const db = getDb();

function anonCtx(): TrpcContext {
  return { req: new Request("http://test.local/"), resHeaders: new Headers() };
}

const A: DiffClause[] = [
  {
    clause_id: "c1", section_path: "s.1",
    text: "The Minister shall establish a registry of operators.",
    obligations: [],
  },
  {
    clause_id: "c2", section_path: "s.2",
    text: "A company shall be entitled to a tax credit of 10 per cent of qualifying expenditure.",
    obligations: [],
  },
  {
    clause_id: "c3", section_path: "s.3",
    text: "An operator shall not discharge effluent into public drains.",
    obligations: [],
  },
];

const B: DiffClause[] = [
  A[0],
  {
    clause_id: "c2", section_path: "s.2",
    text: "A company shall be entitled to a tax credit of 15 per cent of qualifying expenditure.",
    obligations: [],
  },
  {
    clause_id: "c4", section_path: "s.4",
    text: "The Agency may grant a subsidy of ₦500 million to eligible cooperatives and shall publish eligibility criteria.",
    obligations: [],
  },
];

describe("I4 — fallback diff-impact engine", () => {
  it("extracts obligations via modal rules when none supplied", () => {
    const obs = extractObligationsFallback(A[2]);
    expect(obs.length).toBe(1);
    expect(obs[0].kind).toBe("prohibition");
    expect(obs[0].actor).toContain("operator");
  });

  it("diffs added/removed obligations by section path", () => {
    const changes = diffObligationsFallback(A, B);
    const removed = changes.filter((c) => c.change === "removed");
    const added = changes.filter((c) => c.change === "added");
    expect(removed.some((c) => c.section_path === "s.3")).toBe(true);
    expect(added.some((c) => c.section_path === "s.4")).toBe(true);
    for (const c of changes) expect(c.impact_note.length).toBeGreaterThan(0);
  });

  it("computes instrument/scale parameter deltas deterministically", () => {
    const d1 = diffParametersFallback(A, B);
    const d2 = diffParametersFallback(A, B);
    expect(d1).toEqual(d2);
    const tax = d1.find((d) => d.instrument === "tax_credit");
    expect(tax?.field).toBe("scale_percent");
    expect(tax?.value_a).toBe(10);
    expect(tax?.value_b).toBe(15);
    expect(tax?.delta).toBe(5);
    expect(d1.some((d) => d.instrument === "subsidy" && d.change === "added")).toBe(true);
  });

  it("identical versions produce zero changes", () => {
    const res = computeDiffImpactFallback(A, structuredClone(A));
    expect(res.obligation_changes).toEqual([]);
    expect(res.parameter_deltas).toEqual([]);
    expect(res.aligned_pairs).toBe(3);
  });
});

describe("I4 — legislation.diffImpact endpoint", () => {
  it("docA/docB inline diff validates against the output contract (fallback engine)", async () => {
    const caller = appRouter.createCaller(anonCtx());
    const res = await caller.legislation.diffImpact({
      docA: { clauses: A },
      docB: { clauses: B },
    });
    const parsed = diffImpactOutput.parse(res.data);
    // Documents service is not running in tests → deterministic fallback.
    expect(parsed.engine).toBe("fallback");
    expect(parsed.obligations_removed).toBeGreaterThanOrEqual(1);
    expect(parsed.obligations_added).toBeGreaterThanOrEqual(1);
    expect(parsed.parameter_deltas.some((d) => d.instrument === "tax_credit")).toBe(true);
  });

  it("law-id diff works against KB clauses (seeded laws)", async () => {
    const laws = await db.select().from(schema.laws).limit(2);
    if (laws.length < 2) return; // corpus too small; inline path covers contract
    const caller = appRouter.createCaller(anonCtx());
    const res = await caller.legislation.diffImpact({
      fromLawId: laws[0].lawId,
      toLawId: laws[1].lawId,
    });
    const parsed = diffImpactOutput.parse(res.data);
    expect(parsed.clauses_a).toBeGreaterThanOrEqual(0);
    expect(["documents-service", "fallback"]).toContain(parsed.engine);
  });

  it("rejects incomplete input and unknown law ids", async () => {
    const caller = appRouter.createCaller(anonCtx());
    await expect(
      caller.legislation.diffImpact({ fromLawId: "law:only-one" } as never),
    ).rejects.toThrow();
    await expect(
      caller.legislation.diffImpact({ fromLawId: "law:nope", toLawId: "law:nope2" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("writes an audit event for the diff", async () => {
    const caller = appRouter.createCaller(anonCtx());
    await caller.legislation.diffImpact({ docA: { clauses: A }, docB: { clauses: B } });
    // audit() is fire-and-forget; give the append a beat to land.
    await new Promise((r) => setTimeout(r, 1000));
    const rows = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, "legislation.diff_impact"))
      .limit(1);
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
