import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RecommendationContractError,
  extractJson,
  generateWithContract,
  repairPrompt,
  validateRecommendationContract,
  validateRecommendationObject,
} from "../utils/reco-contract";
import {
  fallbackRecommendation,
  generateRecommendation,
  copilotQuery,
} from "../bridges/ai";

const validRec = {
  title: "Recommendation — X",
  rationale: "Grounded in the evidence base with provenance.",
  assumptions: ["a"],
  evidence_base: [
    { evidence_source_id: "ev:sql:nbs", citation: "NBS LFS 2024", confidence: 0.8 },
  ],
  estimated_jobs: { min: 100, max: 300, expected: 200 },
  budget_ranges: [{ min: 10, max: 20, currency: "NGN", unit: "million" }],
  timeline: [{ phase: "p", start_month: 0, duration_months: 6, milestones: ["m"] }],
  implementation_actors: ["MDA"],
  legal_dependencies: [],
  risk_register: [
    { risk: "r", likelihood: "low", impact: "low", mitigation: "m" },
  ],
  kpis: [{ key: "k", label: "l", baseline: 0, target: 1, unit: "u", horizon_months: 12 }],
  simulation_scenarios: [],
  confidence: 0.8,
};

describe("§9.2 contract validator (TS port of services/ai contract.py)", () => {
  it("accepts a valid object and raw JSON text", () => {
    expect(validateRecommendationObject(validRec)).toEqual([]);
    const res = validateRecommendationContract(JSON.stringify(validRec));
    expect(res.ok).toBe(true);
    expect(res.repaired).toBe(false);
  });

  it("repairs fenced/prose-wrapped JSON exactly once (repaired flag)", () => {
    const raw = `Here is the recommendation:\n```json\n${JSON.stringify(validRec)}\n```\nHope this helps.`;
    const res = validateRecommendationContract(raw);
    expect(res.ok).toBe(true);
    expect(res.repaired).toBe(true);
  });

  it("rejects missing keys, empty evidence_base, bad confidence", () => {
    const missing = validateRecommendationObject({ title: "x" });
    expect(missing.some((e) => e.includes("missing required key: rationale"))).toBe(true);
    expect(missing.some((e) => e.includes("key must be a list: kpis"))).toBe(true);

    const noEvidence = validateRecommendationObject({
      ...validRec,
      evidence_base: [],
    });
    expect(noEvidence).toContain("evidence_base must contain at least 1 item");

    const badConf = validateRecommendationObject({ ...validRec, confidence: 1.7 });
    expect(badConf).toContain("confidence must be a number in [0, 1]");

    const noCitation = validateRecommendationObject({
      ...validRec,
      evidence_base: [{ evidence_source_id: "ev:x", citation: "" }],
    });
    expect(noCitation).toContain("every evidence_base item needs a citation");
  });

  it("extractJson reports unparseable output honestly", () => {
    expect(extractJson("no json here").error).toBe("no JSON object found in output");
    expect(extractJson("{ unbalanced").error).toBe("unbalanced braces in output");
    expect(extractJson("[1,2,3]").error).toBe("top-level JSON is not an object");
  });

  it("generateWithContract: invalid → one repair retry → success", async () => {
    const prompts: string[] = [];
    const gen = async (prompt: string) => {
      prompts.push(prompt);
      return prompts.length === 1
        ? "not json at all"
        : JSON.stringify(validRec);
    };
    const out = await generateWithContract(gen, "original prompt");
    expect(out.repairAttempts).toBe(1);
    expect(out.data).toBeTruthy();
    expect(prompts[1]).toContain("FAILED the output contract");
    expect(prompts[1]).toContain("original prompt");
  });

  it("generateWithContract: invalid twice → data null (job must fail)", async () => {
    let calls = 0;
    const gen = async () => {
      calls += 1;
      return "still not json";
    };
    const out = await generateWithContract(gen, "p");
    expect(calls).toBe(2); // exactly one repair retry, never more
    expect(out.data).toBeNull();
    expect(out.result.ok).toBe(false);
  });

  it("repairPrompt carries the validation errors and truncated bad output", () => {
    const p = repairPrompt("orig", "x".repeat(5000), ["e1", "e2"]);
    expect(p).toContain("- e1");
    expect(p).toContain("- e2");
    expect(p.length).toBeLessThan(5000);
  });
});

describe("live generation path guards (api/bridges/ai)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const body = {
    opportunity: {
      opportunity_id: "opp:edu:x",
      title: "Contact me at ada.lovelace@example.test for details",
      sector_code: "edu",
      jurisdiction_id: "jur:ng-kd",
    },
    evidence: [
      {
        evidence_source_id: "ev:sql:nbs",
        source_type: "sql" as const,
        citation: "NBS LFS 2024",
        confidence: 0.8,
        excerpt: "call +2348031234567",
      },
    ],
    legal_dependencies: [],
    simulation_scenarios: [],
  };

  it("PII-redacts inputs before the remote call and outputs before return", async () => {
    const seen: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: unknown, init?: { body?: string }) => {
      seen.push(JSON.parse(init?.body ?? "{}"));
      return new Response(JSON.stringify({ ...validRec, rationale: "reach ada@hq.example.test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const { recommendation, bridge } = await generateRecommendation(body);
    expect(bridge).toBe("remote");
    const sent = JSON.stringify(seen[0]);
    expect(sent).not.toContain("ada.lovelace@example.test");
    expect(sent).not.toContain("+2348031234567");
    expect(sent).toContain("[REDACTED:email]");
    expect(recommendation.rationale).not.toContain("ada@hq.example.test");
  });

  it("remote invalid → one repair retry → still invalid → RecommendationContractError", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return new Response(JSON.stringify({ title: "incomplete" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    await expect(generateRecommendation(body)).rejects.toBeInstanceOf(
      RecommendationContractError,
    );
    expect(calls).toBe(2); // initial + exactly one repair retry
  });

  it("remote invalid → repair retry succeeds → valid path persisted", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      const payload = calls === 1 ? { title: "incomplete" } : validRec;
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const { recommendation, bridge } = await generateRecommendation(body);
    expect(bridge).toBe("remote");
    expect(recommendation.title).toBe(validRec.title);
    expect(calls).toBe(2);
  });

  it("fallback path: valid offline output passes the same contract", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("connection refused");
    });
    const { recommendation, bridge } = await generateRecommendation(body);
    expect(bridge).toBe("fallback");
    expect(validateRecommendationObject(recommendation)).toEqual([]);
    // Input PII redaction also applies on the fallback path.
    expect(recommendation.rationale).not.toContain("ada.lovelace@example.test");
  });

  it("copilot: PII-redacted query in, redacted answer out (remote)", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            answer: "Email the desk at officer@example.test — confidence high.",
            citations: [{ evidence_source_id: "ev:1", citation: "C" }],
            confidence: 0.7,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    const resp = await copilotQuery({
      query: "who handles 08031234567 cases?",
      evidence: [],
    });
    expect(resp.bridge).toBe("remote");
    expect(resp.answer).not.toContain("officer@example.test");
    expect(resp.answer).toContain("[REDACTED:email]");
  });

  it("copilot fallback answer satisfies the minimal contract", () => {
    const rec = fallbackRecommendation({
      opportunity: {
        opportunity_id: "opp:x",
        title: "t",
        sector_code: "edu",
        jurisdiction_id: "jur:ng-kd",
      },
      evidence: [
        {
          evidence_source_id: "ev:sql:nbs",
          source_type: "sql" as const,
          citation: "NBS LFS 2024",
          confidence: 0.8,
        },
      ],
      legalDependencies: [],
      scenarioLinks: [],
    });
    expect(validateRecommendationObject(rec)).toEqual([]);
  });

  it("fallback generator without evidence violates the contract (job must fail, SR-3)", () => {
    const rec = fallbackRecommendation({
      opportunity: {
        opportunity_id: "opp:x",
        title: "t",
        sector_code: "edu",
        jurisdiction_id: "jur:ng-kd",
      },
      evidence: [],
      legalDependencies: [],
      scenarioLinks: [],
    });
    expect(validateRecommendationObject(rec)).toContain(
      "evidence_base must contain at least 1 item",
    );
  });
});
