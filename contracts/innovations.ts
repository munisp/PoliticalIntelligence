import { z } from "zod";
import { SIMULATION_ENGINES } from "./entities";

/**
 * Contracts for the 12 backend innovations (api/innovations.ts).
 * All procedures are envelope-wrapped and zod-validated; numeric outputs
 * are deterministic (seeded / pure functions of DB state).
 */

/* ------------------------------------------------------------------ */
/* 1. Evidence Trust Score — source authority tier table               */
/* ------------------------------------------------------------------ */

/**
 * Source authority tiers (documented policy): official statistics .95,
 * ministry .85, registry .8, crowdsourced/OSM .6, unknown .4.
 */
export const SOURCE_AUTHORITY_TIERS: {
  tier: string;
  authority: number;
  /** Lowercase substrings matched against citation / source metadata. */
  matches: string[];
}[] = [
  {
    tier: "official_statistics",
    authority: 0.95,
    matches: ["nbs", "bureau of statistics", "census", "ubec", "official statistics", "microdata"],
  },
  {
    tier: "ministry",
    authority: 0.85,
    matches: ["ministry", "ministry of", "budget office", "fme", "fmle", "gazette"],
  },
  {
    tier: "registry",
    authority: 0.8,
    matches: ["cac", "corporate affairs", "registry", "bpp", "nocopo", "trcn"],
  },
  {
    tier: "crowdsourced",
    authority: 0.6,
    matches: ["osm", "openstreetmap", "grid3", "crowdsourced", "community"],
  },
];

export const UNKNOWN_SOURCE_AUTHORITY = 0.4;

export const TRUST_SCORE_WEIGHTS = {
  source_authority: 0.35,
  freshness: 0.25,
  corroboration: 0.25,
  extraction_confidence: 0.15,
} as const;

/* ------------------------------------------------------------------ */
/* Zod input schemas                                                    */
/* ------------------------------------------------------------------ */

export const trustScoreInput = z.object({
  evidence_source_id: z.string().min(1),
});

export const scoreDecompositionInput = z.object({
  opportunity_id: z.string().min(1),
});

export const assumptionSensitivityInput = z.object({
  scenario_id: z.string().min(1),
});

export const backtestRunInput = z.object({
  scenario_id: z.string().min(1),
  engine: z.enum(SIMULATION_ENGINES).default("forecast"),
  cutoff_month: z.number().int().min(3).max(33).default(18),
});

/** SIM-5: walk-forward calibration report across all engines. */
export const calibrationReportInput = z.object({
  jurisdiction_id: z.string().min(1),
  engines: z.array(z.enum(SIMULATION_ENGINES)).min(1).max(6).optional(),
  seed: z.number().int().min(0).default(42),
});

export const policyDiffInput = z.object({
  law_id_a: z.string().min(1),
  law_id_b: z.string().min(1),
});

export const procurementAnalysisInput = z.object({
  jurisdiction_id: z.string().min(1),
});

export const recalibrateInput = z.object({
  jurisdiction_id: z.string().min(1),
});

export const templatePublishInput = z.object({
  template_id: z.string().min(1).optional(),
  name: z.string().min(3),
  description: z.string().max(4000).optional(),
  config: z.object({
    intervention_ids: z.array(z.string()).default([]),
    model_plan: z
      .array(
        z.object({
          engine: z.enum(SIMULATION_ENGINES),
          params: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .default([{ engine: "forecast" }]),
    horizon_months: z.number().int().min(1).max(120).default(36),
  }),
  /** Human review per spec: only approved templates become installable. */
  review_state: z.enum(["draft", "in_review", "approved"]).default("in_review"),
});

export const templateInstallInput = z.object({
  template_id: z.string().min(1),
  jurisdiction_id: z.string().min(1),
  name: z.string().min(3).optional(),
});

export const optimizePortfolioInput = z.object({
  jurisdiction_id: z.string().min(1),
  /** Budget envelope in ₦ millions. */
  budget_ngn: z.number().positive(),
  intervention_ids: z.array(z.string().min(1)).min(1).max(50),
  constraints: z
    .object({
      /** Max portfolio-average risk (1 - confidence), 0..1. */
      max_risk: z.number().min(0).max(1).optional(),
      sectors: z.array(z.string()).optional(),
    })
    .optional(),
});

export const parseScenarioTextInput = z.object({
  text: z.string().min(3).max(4000),
  jurisdiction_id: z.string().min(1),
});

export const webhookCreateInput = z.object({
  url: z.string().url().max(512),
  topics: z.array(z.string().min(1)).min(1),
  secret: z.string().min(16).max(128).optional(),
});

export const webhookTestInput = z.object({
  sub_id: z.string().min(1),
});

/* ------------------------------------------------------------------ */
/* Response types                                                       */
/* ------------------------------------------------------------------ */

export interface TrustScoreResult {
  evidence_source_id: string;
  trust_score: number;
  components: {
    source_authority: number;
    freshness: number;
    corroboration: number;
    extraction_confidence: number;
  };
  weights: typeof TRUST_SCORE_WEIGHTS;
  explanation: string;
}

export interface ScoreContribution {
  feature:
    | "jobs_potential"
    | "fiscal_cost"
    | "readiness"
    | "evidence_strength"
    | "risk_penalty";
  /** Raw normalized input 0..1. */
  value: number;
  weight: number;
  /** Waterfall contribution to the final score (signed). */
  contribution: number;
}

export interface ScoreDecompositionResult {
  opportunity_id: string;
  stored_score: number;
  recomputed_score: number;
  /** |stored - recomputed| within this tolerance. */
  tolerance: number;
  contributions: ScoreContribution[];
}

export interface SensitivityEntry {
  key: string;
  label: string;
  base_value: number;
  delta_down: number;
  delta_up: number;
  /** |delta_up - delta_down| — ranking metric. */
  swing: number;
}

export interface BacktestResult {
  scenario_id: string;
  engine: string;
  cutoff_month: number;
  mape: number;
  /** 1 - mape/100, clamped 0..1. */
  skill_score: number;
  series: { month: number; actual: number; projected: number }[];
}

export interface PolicyDiffResult {
  law_id_a: string;
  law_id_b: string;
  aligned: { clause_a: string; clause_b: string; similarity: number }[];
  gap_clauses: { law_id: string; clause_id: string; reason: string }[];
  unique_clauses: { law_id: string; clause_id: string }[];
}

export interface ProcurementAnalysisResult {
  jurisdiction_id: string;
  /** "procurement_records" when the table exists, else "derived_from_opportunities". */
  data_origin: string;
  supplier_concentration_hhi: number;
  repeat_award_ratio: number;
  local_share: number;
  awards_analyzed: number;
  flagged_patterns: { pattern: string; severity: string; evidence_refs: string[] }[];
}

export interface OptimizePortfolioResult {
  selected: {
    intervention_id: string;
    name: string;
    cost_ngn_m: number;
    expected_jobs: number;
    value_density: number;
  }[];
  expected_jobs_total: number;
  cost_total_ngn_m: number;
  budget_ngn_m: number;
  binding_constraints: string[];
}

export interface ParsedScenarioField<T> {
  value: T;
  confidence: number;
  needs_review: boolean;
}

export interface ParsedScenarioConfig {
  jurisdiction_id: string;
  sector_code: ParsedScenarioField<string | null>;
  budget_ngn_m: ParsedScenarioField<number | null>;
  horizon_months: ParsedScenarioField<number | null>;
  intervention_hints: string[];
  model_plan: { engine: (typeof SIMULATION_ENGINES)[number] }[];
  llm_assisted: boolean;
  overall_confidence: number;
}
