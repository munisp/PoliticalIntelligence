import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import {
  candidateFromClause,
  detectPopulations,
  detectSector,
  mapClausesLocal,
  parseAmount,
  parseDurationMonths,
  parsePercentage,
} from "../bridges/paramMapper";
import {
  assumptionCandidateSchema,
  mapBillToParametersInput,
  paramMapResultSchema,
} from "@contracts/param-mapper";
import type { ClauseArtifact } from "@contracts/documents";
import type { TrpcContext } from "../context";
import type { User } from "@db/schema";

/**
 * G3 param-mapper API tests. The documents service is simulated as
 * unreachable (like api/tests/documents.test.ts) so the deterministic
 * fallback rule engine and the procedure wiring are exercised.
 */

const realFetch = globalThis.fetch;

beforeEach(() => {
  process.env.DOCUMENTS_BASE_URL = "http://127.0.0.1:8400";
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    const href = String(url);
    if (href.includes("127.0.0.1:8400") || href.includes("localhost:8400")) {
      throw new TypeError("fetch failed");
    }
    return realFetch(url as string, init);
  });
});

afterEach(() => {
  vi.stubGlobal("fetch", realFetch);
});

async function demoUser(unionId: string): Promise<User> {
  const user = await getDb().query.users.findFirst({
    where: eq(schema.users.unionId, unionId),
  });
  if (!user) throw new Error(`seed user ${unionId} missing — run db/seed.ts`);
  return user;
}

async function adminCtx(): Promise<TrpcContext> {
  const u = await demoUser("demo-sim-specialist");
  return ctxFor({ ...u, platformRole: "platform_admin" });
}

function ctxFor(user?: User): TrpcContext {
  return {
    req: new Request("http://test.local/"),
    resHeaders: new Headers(),
    ...(user ? { user } : {}),
  } as TrpcContext;
}

const clause = (
  text: string,
  overrides: Partial<ClauseArtifact> = {},
): ClauseArtifact => ({
  clause_id: "clause:1",
  section_path: "s.1",
  text,
  kind: "section",
  confidence: 0.9,
  obligations: [],
  defined_terms: [],
  citations: [],
  ...overrides,
});

describe("G3 param-mapper bridge (deterministic rules)", () => {
  it("parses percentages, amounts (with currency hint) and durations", () => {
    expect(parsePercentage("shall pay 7.5% of payroll")).toBe(7.5);
    expect(parsePercentage("a rebate of 10 per cent")).toBe(10);
    expect(parsePercentage("nothing")).toBeNull();
    expect(parseAmount("section 15 million shall apply")).toBeNull();
    expect(parseAmount("a grant of ₦250 million")).toBe(250_000_000);
    expect(parseAmount("fine of NGN 5,000 thousand")).toBe(5_000_000);
    expect(parseDurationMonths("for a period of 5 years")).toBe(60);
    expect(parseDurationMonths("within 18 months")).toBe(18);
  });

  it("classifies every instrument class", () => {
    const cases: Array<[string, string]> = [
      ["a tax credit of 15 per cent of expenditure", "tax_credit"],
      ["a subsidy of 20 percent on fertiliser", "subsidy"],
      ["shall award a grant of ₦50 million", "grant"],
      ["a preference margin of 15 per cent for local content", "procurement_quota"],
      ["shall pay a training levy of 1 per cent of payroll", "training_levy"],
      ["emissions shall not exceed the threshold of 250 units", "regulatory_threshold"],
      ["a fine of NGN 5 million applies for every offence", "penalty"],
    ];
    for (const [text, instrument] of cases) {
      const c = candidateFromClause(clause(text));
      expect(c, text).not.toBeNull();
      expect(c!.instrument).toBe(instrument);
      expect(c!.requires_analyst_review).toBe(true);
      expect(c!.confidence).toBeGreaterThan(0);
      expect(c!.rationale.length).toBeGreaterThan(0);
    }
  });

  it("detects sectors and target populations via lexicon", () => {
    expect(detectSector("support for agriculture and livestock")).toBe("agriculture");
    expect(detectSector("every public hospital")).toBe("health");
    expect(detectSector("broadband and digital services")).toBe("ICT");
    expect(detectSector("the accounting officer shall keep records")).toBeNull();
    expect(detectPopulations("small and medium enterprises and youth")).toEqual([
      "SME",
      "youth",
    ]);
    expect(detectPopulations("women-owned businesses")).toContain("women");
  });

  it("is deterministic and ranked by confidence desc", () => {
    const clauses = [
      clause("A company shall be entitled to a tax credit of 15 per cent of qualifying expenditure.", { clause_id: "clause:2", section_path: "s.2" }),
      clause("Every employer shall pay a training levy of 1 per cent of annual payroll.", { clause_id: "clause:5", section_path: "s.5", confidence: 0.95 }),
    ];
    const r1 = mapClausesLocal(clauses);
    const r2 = mapClausesLocal(clauses);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    expect(r1.requires_analyst_review).toBe(true);
    expect(r1.clause_count).toBe(2);
    const confs = r1.candidates.map((c) => c.confidence);
    expect(confs).toEqual([...confs].sort((a, b) => b - a));
    for (const cand of r1.candidates) {
      assumptionCandidateSchema.parse(cand);
      expect(cand.rationale.every((r) => r.span.trim().length > 0)).toBe(true);
      expect(cand.rationale.some((r) => r.parameter === "instrument")).toBe(true);
    }
    paramMapResultSchema.parse(r1);
  });

  it("merges same instrument+sector and validates the input contract", () => {
    const merged = mapClausesLocal([
      clause("The Board may award a grant of ₦10 million to a school.", { clause_id: "clause:1" }),
      clause("The Board may award a grant of ₦20 million to a university.", { clause_id: "clause:2" }),
    ]);
    expect(merged.candidates).toHaveLength(1);
    expect(merged.candidates[0].sector).toBe("education");
    // input contract: at least one of law_id/document_id
    expect(mapBillToParametersInput.safeParse({}).success).toBe(false);
    expect(mapBillToParametersInput.safeParse({ law_id: "law:ng:ppa-2007" }).success).toBe(true);
    expect(mapBillToParametersInput.safeParse({ document_id: "doc:x" }).success).toBe(true);
  });
});

describe("scenarios.mapBillToParameters procedure", () => {
  it("rejects anonymous and wrong-role callers", async () => {
    const anon = appRouter.createCaller(ctxFor());
    await expect(
      anon.scenarios.mapBillToParameters({ law_id: "law:ng:ppa-2007" }),
    ).rejects.toThrow();
    const legal = appRouter.createCaller(ctxFor(await demoUser("demo-legal-analyst")));
    await expect(
      legal.scenarios.mapBillToParameters({ law_id: "law:ng:ppa-2007" }),
    ).rejects.toThrow(/Requires one of/i);
  });

  it("maps a seeded law to candidates via the deterministic fallback (audited envelope)", async () => {
    const caller = appRouter.createCaller(await adminCtx());
    const res = await caller.scenarios.mapBillToParameters({
      law_id: "law:ng:ppa-2007",
    });
    const d = res.data;
    expect(d.law_id).toBe("law:ng:ppa-2007");
    expect(d.mapper_source).toBe("fallback"); // service stubbed unreachable
    expect(d.requires_analyst_review).toBe(true);
    expect(d.clause_count).toBeGreaterThan(0);
    // PPA s.34: "margin of preference ... local content" → procurement_quota
    const instruments = d.candidates.map((c) => c.instrument);
    expect(instruments).toContain("procurement_quota");
    for (const cand of d.candidates) {
      expect(cand.requires_analyst_review).toBe(true);
      expect(cand.confidence).toBeGreaterThan(0);
      expect(cand.confidence).toBeLessThanOrEqual(1);
      expect(cand.rationale.length).toBeGreaterThan(0);
    }
    paramMapResultSchema.parse({
      candidates: d.candidates,
      clause_count: d.clause_count,
      requires_analyst_review: d.requires_analyst_review,
    });
  });

  it("404s on unknown law", async () => {
    const caller = appRouter.createCaller(
      ctxFor(await demoUser("demo-sim-specialist")),
    );
    await expect(
      caller.scenarios.mapBillToParameters({ law_id: "law:nope:missing" }),
    ).rejects.toThrow(/not found/i);
  });
});
