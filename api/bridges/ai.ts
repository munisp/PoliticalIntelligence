import type {
  EvidenceSourceType,
  Recommendation,
} from "@contracts/entities";
import { mulberry32, hashSeed } from "../utils/prng";

/**
 * Bridge to services/ai (retrieval orchestration + LLM routing).
 * POST /v1/recommendations → Recommendation contract (spec §9.2)
 * POST /v1/copilot/query   → {answer, citations, confidence}
 * Falls back to deterministic in-process generators when unreachable (5s),
 * grounding outputs in DB evidence passed in by the caller — vector/graph
 * adapters plug into services/ai, the SQL fallback lives in queries/admin.ts.
 */

const BASE_URL = process.env.AI_BASE_URL ?? "http://localhost:8200";
const TIMEOUT_MS = 5000;

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`ai service ${resp.status}`);
    return (await resp.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export interface EvidenceSnippet {
  evidence_source_id: string;
  source_type: EvidenceSourceType;
  citation: string;
  confidence: number;
  excerpt?: string | null;
}

export interface OpportunityContext {
  opportunity_id: string;
  title: string;
  summary?: string | null;
  sector_code: string;
  jurisdiction_id: string;
  estimated_jobs_min?: number | null;
  estimated_jobs_max?: number | null;
  budget_min?: number | null;
  budget_max?: number | null;
  horizon_months?: number | null;
}

/* ------------------------------------------------------------------ */
/* Recommendation generation                                           */
/* ------------------------------------------------------------------ */

/** Deterministic local recommendation (same input ⇒ same output). */
export function fallbackRecommendation(opts: {
  opportunity: OpportunityContext;
  evidence: EvidenceSnippet[];
  legalDependencies: { law_id: string; clause_ids: string[]; note: string }[];
  scenarioLinks: { scenario_id: string; engine: Recommendation["simulation_scenarios"][number]["engine"] }[];
  seed?: number;
}): Recommendation {
  const { opportunity: o } = opts;
  const seed = opts.seed ?? hashSeed(o.opportunity_id);
  const rand = mulberry32(seed);
  const jobsMin = o.estimated_jobs_min ?? 500;
  const jobsMax = o.estimated_jobs_max ?? jobsMin * 3;
  const expected = Math.round(jobsMin + (jobsMax - jobsMin) * (0.4 + 0.2 * rand()));
  const budgetMin = o.budget_min ?? 500;
  const budgetMax = o.budget_max ?? budgetMin * 4;
  const horizon = o.horizon_months ?? 36;
  const avgConfidence =
    opts.evidence.length > 0
      ? opts.evidence.reduce((s, e) => s + e.confidence, 0) / opts.evidence.length
      : 0.5;

  return {
    recommendation_id: `rec:${o.opportunity_id.replace(/^opp:/, "").replace(/:/g, "-")}`,
    title: `Recommendation — ${o.title}`,
    rationale:
      `${o.title} in ${o.jurisdiction_id} is supported by ${opts.evidence.length} ` +
      `evidence source(s) with mean confidence ${avgConfidence.toFixed(2)}. ` +
      `Sector baseline data and pipeline freshness indicate a viable window over ` +
      `the next ${horizon} months; the intervention pairs direct job creation with ` +
      `enabling legal instruments already in force.`,
    assumptions: [
      `Counterpart funding of ₦${Math.round(budgetMin)}m–₦${Math.round(budgetMax)}m is appropriated in the next budget cycle`,
      "Implementing agencies retain current staffing and procurement capacity",
      "Macro conditions (inflation, FX) remain within the 2024–2025 observed band",
      "Data pipelines for the cited evidence sources refresh on cadence",
    ],
    evidence_base: opts.evidence.map((e) => ({
      evidence_source_id: e.evidence_source_id,
      citation: e.citation,
      confidence: e.confidence,
    })),
    estimated_jobs: { min: jobsMin, max: jobsMax, expected },
    budget_ranges: [
      { min: budgetMin, max: budgetMax, currency: "NGN", unit: "million" },
    ],
    timeline: [
      {
        phase: "Mobilisation & procurement setup",
        start_month: 0,
        duration_months: Math.max(3, Math.round(horizon * 0.15)),
        milestones: ["Implementation plan approved", "Procurement frameworks executed"],
      },
      {
        phase: "Rollout (pilot LGAs)",
        start_month: Math.max(3, Math.round(horizon * 0.15)),
        duration_months: Math.round(horizon * 0.35),
        milestones: ["First cohort deployed", "Baseline KPI capture"],
      },
      {
        phase: "State-wide scale",
        start_month: Math.round(horizon * 0.5),
        duration_months: horizon - Math.round(horizon * 0.5),
        milestones: ["Full LGA coverage", "Mid-line evaluation", "Scale decision gate"],
      },
    ],
    implementation_actors: [
      "State Ministry responsible for the sector",
      "Kaduna State Bureau of Public Procurement",
      "LGA implementation units (pilot set)",
      "MDA data & M&E desk",
    ],
    legal_dependencies: opts.legalDependencies,
    risk_register: [
      {
        risk: "Funding release delays",
        likelihood: "medium",
        impact: "high",
        mitigation: "Phase procurements; secure first-line charge in budget",
      },
      {
        risk: "Implementation capacity constraints at LGA level",
        likelihood: "medium",
        impact: "medium",
        mitigation: "Embedded delivery support unit; staged LGA onboarding",
      },
      {
        risk: "Data gaps weaken targeting",
        likelihood: "low",
        impact: "medium",
        mitigation: "Refresh cited pipelines before rollout; verify with field enumeration",
      },
    ],
    kpis: [
      {
        key: "jobs_created",
        label: "Net new jobs",
        baseline: 0,
        target: expected,
        unit: "jobs",
        horizon_months: horizon,
      },
      {
        key: "evidence_freshness",
        label: "Evidence freshness",
        baseline: avgConfidence,
        target: 0.85,
        unit: "confidence",
        horizon_months: horizon,
      },
    ],
    simulation_scenarios: opts.scenarioLinks,
    confidence: Math.round(avgConfidence * 100) / 100,
    generated_at: new Date(0), // deterministic marker; replaced by caller
  };
}

export async function generateRecommendation(body: {
  opportunity: OpportunityContext;
  evidence: EvidenceSnippet[];
  legal_dependencies: Recommendation["legal_dependencies"];
  simulation_scenarios: Recommendation["simulation_scenarios"];
}): Promise<{ recommendation: Recommendation; bridge: "remote" | "fallback" }> {
  const { llmRoutingDecisions } = await import("../utils/metrics");
  try {
    const recommendation = await postJson<Recommendation>(
      "/v1/recommendations",
      body,
    );
    llmRoutingDecisions.inc({ tier: "remote" });
    return { recommendation, bridge: "remote" };
  } catch {
    llmRoutingDecisions.inc({ tier: "offline-fallback" });
    const recommendation = fallbackRecommendation({
      opportunity: body.opportunity,
      evidence: body.evidence,
      legalDependencies: body.legal_dependencies,
      scenarioLinks: body.simulation_scenarios,
    });
    recommendation.generated_at = new Date();
    return { recommendation, bridge: "fallback" };
  }
}

/* ------------------------------------------------------------------ */
/* Copilot                                                             */
/* ------------------------------------------------------------------ */

export interface CopilotAnswer {
  answer: string;
  citations: { evidence_source_id: string; citation: string }[];
  confidence: number;
  bridge: "remote" | "fallback";
}

export function fallbackCopilotAnswer(opts: {
  query: string;
  evidence: EvidenceSnippet[];
}): CopilotAnswer {
  const top = [...opts.evidence]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
  const avg =
    top.length > 0
      ? top.reduce((s, e) => s + e.confidence, 0) / top.length
      : 0.4;
  const answer =
    top.length === 0
      ? `No grounded evidence was found for "${opts.query}" in the current jurisdiction scope. Consider broadening the query or checking data-source freshness.`
      : `Based on ${top.length} retrieved evidence source(s) (mean confidence ${avg.toFixed(2)}): ` +
        top
          .map(
            (e, i) =>
              `[${i + 1}] ${e.excerpt?.slice(0, 180) ?? e.citation}`,
          )
          .join(" ") +
        " This answer is generated by the offline fallback engine; connect the AI service for full synthesis.";
  return {
    answer,
    citations: top.map((e) => ({
      evidence_source_id: e.evidence_source_id,
      citation: e.citation,
    })),
    confidence: Math.round(avg * 100) / 100,
    bridge: "fallback",
  };
}

export async function copilotQuery(body: {
  query: string;
  jurisdiction_id?: string;
  evidence: EvidenceSnippet[];
}): Promise<CopilotAnswer> {
  try {
    const resp = await postJson<Omit<CopilotAnswer, "bridge">>(
      "/v1/copilot/query",
      body,
    );
    return { ...resp, bridge: "remote" };
  } catch {
    return fallbackCopilotAnswer({ query: body.query, evidence: body.evidence });
  }
}
