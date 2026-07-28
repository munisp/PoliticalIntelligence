import type {
  EvidenceSourceType,
  Recommendation,
} from "@contracts/entities";
import { mulberry32, hashSeed } from "../utils/prng";
import {
  RecommendationContractError,
  assertValidRecommendation,
  validateRecommendationObject,
} from "../utils/reco-contract";
import { redactPayload, logRedactionEvent, type RedactionCounts } from "../utils/pii";

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

/* ------------------------------------------------------------------ */
/* PII + contract guards on the generation path (AI-11, §9.2)          */
/* ------------------------------------------------------------------ */

/** Deep-redact a payload, logging COUNTS only (never the PII). */
function redact<T>(surface: string, value: T): T {
  if (process.env.PII_REDACTION === "off") return value;
  const counts: RedactionCounts = {};
  const out = redactPayload(value, undefined, counts) as T;
  logRedactionEvent(surface, counts);
  return out;
}

/** Persist a contract-validation failure to the audit trail (best-effort). */
async function auditContractFailure(
  surface: string,
  errors: string[],
  repaired: boolean,
): Promise<void> {
  console.error(
    `[contract] ${surface} validation failed repaired=${repaired}: ${errors.join("; ")}`,
  );
  try {
    const { insertAuditEvent } = await import("../queries/audit");
    await insertAuditEvent({
      actorId: null,
      action: "recommendations.contract_validation_failed",
      entityType: "recommendation",
      entityId: surface,
      payload: { errors, repaired } as never,
    });
  } catch (err) {
    console.error("[contract] audit insert failed:", err);
  }
}

/**
 * Validate a remote bridge response against the §9.2 contract with ONE
 * repair retry (the request is re-POSTed with the validation errors
 * attached so the service can self-correct). Throws
 * RecommendationContractError when the output is still invalid — callers
 * must fail the job rather than persist a non-conformant recommendation.
 */
async function postJsonValidated<T>(
  path: string,
  body: unknown,
  surface: string,
  validate: (obj: unknown) => string[],
): Promise<T> {
  const first = await postJson<unknown>(path, body);
  let errors = validate(first);
  if (errors.length === 0) return first as T;
  await auditContractFailure(surface, errors, false);
  // Single repair retry.
  const repaired = await postJson<unknown>(path, {
    ...(body as Record<string, unknown>),
    repair_errors: errors,
    repair_instruction:
      "Your previous answer FAILED the output contract. Return ONLY the corrected payload.",
  });
  errors = validate(repaired);
  if (errors.length === 0) return repaired as T;
  await auditContractFailure(surface, errors, true);
  throw new RecommendationContractError(errors);
}

/** AI-8: routing decision record persisted to the immutable audit store. */
export interface ModelRoutingRecord {
  tier: "remote" | "offline-fallback";
  model: string;
  fallback: boolean;
  decided_at: string;
}

export async function generateRecommendation(body: {
  opportunity: OpportunityContext;
  evidence: EvidenceSnippet[];
  legal_dependencies: Recommendation["legal_dependencies"];
  simulation_scenarios: Recommendation["simulation_scenarios"];
}): Promise<{
  recommendation: Recommendation;
  bridge: "remote" | "fallback";
  routing: ModelRoutingRecord;
}> {
  const { llmRoutingDecisions } = await import("../utils/metrics");
  // PII redaction on the generation INPUT before it leaves the gateway.
  const safeBody = redact("bridge.recommendations.input", body);
  try {
    const recommendation = await postJsonValidated<Recommendation>(
      "/v1/recommendations",
      safeBody,
      "bridge.recommendations",
      validateRecommendationObject,
    );
    llmRoutingDecisions.inc({ tier: "remote" });
    // PII redaction on the generated OUTPUT before persistence.
    return {
      recommendation: redact("bridge.recommendations.output", recommendation),
      bridge: "remote",
      routing: {
        tier: "remote",
        model: "serving-tier",
        fallback: false,
        decided_at: new Date().toISOString(),
      },
    };
  } catch (err) {
    if (err instanceof RecommendationContractError) throw err; // fail the job
    llmRoutingDecisions.inc({ tier: "offline-fallback" });
    const recommendation = fallbackRecommendation({
      opportunity: safeBody.opportunity,
      evidence: safeBody.evidence,
      legalDependencies: safeBody.legal_dependencies,
      scenarioLinks: safeBody.simulation_scenarios,
    });
    recommendation.generated_at = new Date();
    // The offline path must satisfy the same contract before persistence.
    assertValidRecommendation(recommendation);
    return {
      recommendation: redact("bridge.recommendations.output", recommendation),
      bridge: "fallback",
      routing: {
        tier: "offline-fallback",
        model: "deterministic",
        fallback: true,
        decided_at: new Date().toISOString(),
      },
    };
  }
}

/* ------------------------------------------------------------------ */
/* Hybrid retrieval (AI-4): gateway search → AI service /v1/retrieve   */
/* ------------------------------------------------------------------ */

export interface RetrievedEvidence {
  evidence_source_id: string;
  source_type: "metric" | "legal" | "policy" | "profile";
  citation: string;
  retrieval_path: "sql" | "vector" | "graph";
  confidence: number;
  content: string;
  attributes: Record<string, unknown>;
}

export interface EvidenceBundle {
  bundle_id: string;
  query: string;
  jurisdiction_id: string;
  evidence: RetrievedEvidence[];
  retrieval_paths_used: string[];
  adapter_modes: Record<string, string>;
}

/**
 * POST /v1/retrieve on the AI service (hybrid SQL+vector+graph with RRF
 * fusion). Throws when the service is unreachable/errors — callers fall
 * back to the SQL LIKE path.
 */
export async function retrieveBundle(body: {
  query: string;
  jurisdiction_id?: string;
  filters?: Record<string, unknown>;
  top_k?: number;
}): Promise<EvidenceBundle> {
  const resp = await postJson<{ data: EvidenceBundle }>("/v1/retrieve", {
    query: body.query,
    jurisdiction_id: body.jurisdiction_id ?? "jur:ng",
    filters: body.filters ?? {},
    top_k: body.top_k ?? 10,
  });
  if (!resp?.data || !Array.isArray(resp.data.evidence)) {
    throw new Error("ai service returned malformed EvidenceBundle");
  }
  return resp.data;
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

/** Minimal copilot output contract: grounded answer + citations list. */
function validateCopilotObject(obj: unknown): string[] {
  const errors: string[] = [];
  const o = obj as Partial<CopilotAnswer> | null;
  if (!o || typeof o !== "object") return ["copilot answer is not an object"];
  if (typeof o.answer !== "string" || o.answer.trim() === "")
    errors.push("answer must be a non-empty string");
  if (!Array.isArray(o.citations)) errors.push("citations must be a list");
  if (
    o.confidence !== undefined &&
    !(typeof o.confidence === "number" && o.confidence >= 0 && o.confidence <= 1)
  )
    errors.push("confidence must be a number in [0, 1]");
  return errors;
}

/* ------------------------------------------------------------------ */
/* Brief section drafting (G5): serving-tier path with template fallback */
/* ------------------------------------------------------------------ */

export const BRIEF_SECTION_HEADINGS = [
  "Executive summary",
  "Situation",
  "Options",
  "Recommendation",
] as const;

/** Deterministic template bodies — the pre-G5 behavior, kept as the
 *  offline fallback so generated briefs never depend on GPU availability. */
export function templateBriefSections(): { heading: string; body: string }[] {
  return [
    {
      heading: "Executive summary",
      body: "This brief was generated from the current evidence base and ranked opportunities for the jurisdiction. All figures carry confidence scores and provenance in the citations rail.",
    },
    {
      heading: "Situation",
      body: "Sector metrics and pipeline freshness indicate a viable intervention window. See Evidence drawer for source-level detail.",
    },
    {
      heading: "Options",
      body: "Options are ranked by opportunity score, estimated jobs, and legal readiness. Human review is required before sign-off.",
    },
    {
      heading: "Recommendation",
      body: "Proceed with the top-ranked option under phased procurement, subject to executive sign-off.",
    },
  ];
}

export interface DraftedBriefSections {
  sections: { heading: string; body: string }[];
  bridge: "remote" | "fallback";
  routing: ModelRoutingRecord;
}

/**
 * Draft brief section bodies through the serving tier. Builds one grounded
 * copilot query per section over the retrieval bundle (evidence rail); when
 * the serving tier responds offline (or is unreachable) the deterministic
 * template bodies are used instead — keeping tests and GPU-less
 * environments fully deterministic.
 *
 * `queryFn` is injectable so tests can mock the serving client.
 */
export async function draftBriefSections(body: {
  title: string;
  template: string;
  jurisdiction_id: string;
  section_headings?: string[];
  evidence: EvidenceSnippet[];
  queryFn?: typeof copilotQuery;
}): Promise<DraftedBriefSections> {
  const headings = body.section_headings ?? [...BRIEF_SECTION_HEADINGS];
  const query = body.queryFn ?? copilotQuery;
  const { llmRoutingDecisions } = await import("../utils/metrics");
  const fallback: DraftedBriefSections = {
    sections: templateBriefSections().filter((t) => headings.includes(t.heading)),
    bridge: "fallback",
    routing: {
      tier: "offline-fallback",
      model: "deterministic",
      fallback: true,
      decided_at: new Date().toISOString(),
    },
  };
  try {
    const sections: { heading: string; body: string }[] = [];
    for (const heading of headings) {
      const resp = await query({
        query:
          `Draft the "${heading}" section of the ${body.template} brief ` +
          `"${body.title}". Two to four sentences, grounded only in the ` +
          `provided evidence, with [n] citation markers.`,
        jurisdiction_id: body.jurisdiction_id,
        evidence: body.evidence,
      });
      if (resp.bridge !== "remote" || !resp.answer.trim()) {
        // Offline tier responded — deterministic template fallback.
        llmRoutingDecisions.inc({ tier: "offline-fallback" });
        return fallback;
      }
      sections.push({ heading, body: resp.answer.trim() });
    }
    llmRoutingDecisions.inc({ tier: "remote" });
    return {
      sections,
      bridge: "remote",
      routing: {
        tier: "remote",
        model: "serving-tier",
        fallback: false,
        decided_at: new Date().toISOString(),
      },
    };
  } catch {
    llmRoutingDecisions.inc({ tier: "offline-fallback" });
    return fallback;
  }
}

export async function copilotQuery(body: {
  query: string;
  jurisdiction_id?: string;
  evidence: EvidenceSnippet[];
}): Promise<CopilotAnswer> {
  // PII redaction on the copilot INPUT (belt-and-braces with the tRPC
  // input middleware — the bridge is also called from non-tRPC paths).
  const safeBody = redact("bridge.copilot.input", body);
  try {
    const resp = await postJsonValidated<Omit<CopilotAnswer, "bridge">>(
      "/v1/copilot/query",
      safeBody,
      "bridge.copilot",
      validateCopilotObject,
    );
    // PII redaction on the generated OUTPUT before it is stored/returned.
    return { ...redact("bridge.copilot.output", resp), bridge: "remote" };
  } catch (err) {
    if (err instanceof RecommendationContractError) throw err;
    const fallback = fallbackCopilotAnswer({
      query: safeBody.query,
      evidence: safeBody.evidence,
    });
    return redact("bridge.copilot.output", fallback);
  }
}
