import { describe, expect, it } from "vitest";
import { SIMULATION_ENGINES } from "@contracts/entities";
import { runFallbackEngine, type ScenarioRunRequest } from "../bridges/simulation";
import {
  fallbackRecommendation,
  fallbackCopilotAnswer,
} from "../bridges/ai";

const baseReq: ScenarioRunRequest = {
  scenario_id: "scn:001",
  engine: "forecast",
  seed: 42,
  horizon_months: 36,
  baseline_employment: 3_600_000,
  intervention_strength: 0.6,
};

describe("simulation fallback engines", () => {
  it("every engine produces an 80% band series over the full horizon", () => {
    for (const engine of SIMULATION_ENGINES) {
      const result = runFallbackEngine({ ...baseReq, engine });
      expect(result.engine).toBe(engine);
      expect(result.series.length).toBe(37); // months 0..36
      for (const p of result.series) {
        expect(p.lower).toBeLessThanOrEqual(p.mean);
        expect(p.upper).toBeGreaterThanOrEqual(p.mean);
      }
      expect(result.seed).toBe(42);
    }
  });

  it("is deterministic for the same seed and differs across seeds", () => {
    const a = runFallbackEngine({ ...baseReq, engine: "abm" });
    const b = runFallbackEngine({ ...baseReq, engine: "abm" });
    const c = runFallbackEngine({ ...baseReq, engine: "abm", seed: 43 });
    expect(a).toEqual(b);
    expect(a.series[12].mean).not.toBe(c.series[12].mean);
  });
});

describe("ai fallback recommendation", () => {
  const evidence = [
    {
      evidence_source_id: "ev:sql:nbs-lfs-2024",
      source_type: "sql" as const,
      citation: "NBS LFS Q3 2024",
      confidence: 0.82,
      excerpt: "Kaduna unemployment 29.8%",
    },
  ];

  it("produces the full spec §9.2 contract", () => {
    const rec = fallbackRecommendation({
      opportunity: {
        opportunity_id: "opp:edu:teacher-pipeline",
        title: "Teacher recruitment & training pipeline",
        sector_code: "edu",
        jurisdiction_id: "jur:ng-kd",
        estimated_jobs_min: 18_000,
        estimated_jobs_max: 27_000,
        budget_min: 38_000,
        budget_max: 54_000,
        horizon_months: 36,
      },
      evidence,
      legalDependencies: [
        {
          law_id: "law:ng-kd:teacher-licensing",
          clause_ids: ["cls:law:ng-kd:teacher-licensing:s3"],
          note: "Licensing framework governs registration.",
        },
      ],
      scenarioLinks: [{ scenario_id: "scn:001", engine: "forecast" }],
    });
    expect(rec.recommendation_id).toBe("rec:edu-teacher-pipeline");
    expect(rec.rationale.length).toBeGreaterThan(20);
    expect(rec.assumptions.length).toBeGreaterThan(0);
    expect(rec.evidence_base).toHaveLength(1);
    expect(rec.estimated_jobs.expected).toBeGreaterThanOrEqual(18_000);
    expect(rec.estimated_jobs.expected).toBeLessThanOrEqual(27_000);
    expect(rec.budget_ranges[0].currency).toBe("NGN");
    expect(rec.timeline.length).toBeGreaterThanOrEqual(2);
    expect(rec.implementation_actors.length).toBeGreaterThan(0);
    expect(rec.legal_dependencies[0].law_id).toBe("law:ng-kd:teacher-licensing");
    expect(rec.risk_register.length).toBeGreaterThan(0);
    expect(rec.kpis[0].target).toBe(rec.estimated_jobs.expected);
    expect(rec.simulation_scenarios[0].scenario_id).toBe("scn:001");
    expect(rec.confidence).toBeCloseTo(0.82, 2);
  });

  it("is deterministic given the same input", () => {
    const opts = {
      opportunity: {
        opportunity_id: "opp:proc:lga-supplier-development",
        title: "LGA procurement supplier development",
        sector_code: "proc",
        jurisdiction_id: "jur:ng-kd",
      },
      evidence,
      legalDependencies: [],
      scenarioLinks: [],
    };
    expect(fallbackRecommendation(opts)).toEqual(fallbackRecommendation(opts));
  });
});

describe("ai fallback copilot", () => {
  it("answers with citations ranked by confidence", () => {
    const answer = fallbackCopilotAnswer({
      query: "What is the unemployment rate in Kaduna?",
      evidence: [
        {
          evidence_source_id: "ev:sql:low",
          source_type: "sql",
          citation: "Low source",
          confidence: 0.4,
          excerpt: "low",
        },
        {
          evidence_source_id: "ev:sql:nbs-lfs-2024",
          source_type: "sql",
          citation: "NBS LFS Q3 2024",
          confidence: 0.82,
          excerpt: "Kaduna unemployment 29.8%",
        },
      ],
    });
    expect(answer.bridge).toBe("fallback");
    expect(answer.citations[0].evidence_source_id).toBe("ev:sql:nbs-lfs-2024");
    expect(answer.confidence).toBeGreaterThan(0.4);
  });

  it("degrades gracefully with no evidence", () => {
    const answer = fallbackCopilotAnswer({ query: "anything", evidence: [] });
    expect(answer.citations).toHaveLength(0);
    expect(answer.answer).toContain("No grounded evidence");
  });
});
