/**
 * Canonical schema pack (spec §39) — shared between api/ and src/.
 * Frontend must NEVER import from api/ or db/ directly; it consumes these
 * contracts plus the entity types re-exported through contracts/types.ts.
 */

/* ------------------------------------------------------------------ */
/* Canonical ID formats                                                */
/* ------------------------------------------------------------------ */

/**
 * ID formats (canonical):
 *  - Jurisdiction:   `jur:<country>-<region>`      e.g. jur:ng-kd (Kaduna)
 *  - Admin unit:     `adm:<country>-<code>`        e.g. adm:ng-kd-chikun
 *  - Sector:         bare sector code              e.g. edu, sme, proc, agro, digital
 *  - Opportunity:    `opp:<sector>:<slug>`         e.g. opp:edu:teacher-pipeline
 *  - Intervention:   `itv:<slug>`
 *  - Recommendation: `rec:<slug>`
 *  - Scenario:       `scn:<nnn>`                   e.g. scn:001
 *  - Assumption set: `asm:<sector>:<name>`         e.g. asm:edu:base
 *  - Simulation run: `sim:<nnn>`
 *  - Evidence:       `ev:<source>:<slug>`          e.g. ev:sql:nbs-lfs-2024
 *  - Job:            `job:<nanoid>`
 *  - Law / clause:   `law:<jur>:<slug>` / `cls:<law>:<section>`
 *  - Document:       `doc:<jur>:<slug>`
 *  - Brief:          `brf:<jur>:<slug>`
 *  - Data source:    `src:<slug>`                  e.g. src:nbs
 *  - Pipeline run:   `run:<slug>:<yyyymmdd>`
 *  - Review task:    `task:<nnn>`
 */
export const IdPrefixes = {
  jurisdiction: "jur",
  adminUnit: "adm",
  opportunity: "opp",
  intervention: "itv",
  recommendation: "rec",
  scenario: "scn",
  assumptionSet: "asm",
  simulationRun: "sim",
  evidence: "ev",
  job: "job",
  law: "law",
  clause: "cls",
  document: "doc",
  brief: "brf",
  dataSource: "src",
  pipelineRun: "run",
  reviewTask: "task",
} as const;

export function makeId(prefix: keyof typeof IdPrefixes, ...parts: string[]) {
  return [IdPrefixes[prefix], ...parts].join(":");
}

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

/** Review / approval lifecycle (spec §27). */
export const REVIEW_STATES = [
  "draft",
  "in_review",
  "approved",
  "signed_off",
  "returned",
] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

/** Async job lifecycle. */
export const JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Confidence tiers (design.md §2 thresholds). */
export const CONFIDENCE_TIERS = ["high", "medium", "low"] as const;
export type ConfidenceTier = (typeof CONFIDENCE_TIERS)[number];

export function confidenceTier(score: number): ConfidenceTier {
  if (score >= 0.75) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

/** Data-source health. */
export const SOURCE_HEALTH = ["healthy", "stale", "failing"] as const;
export type SourceHealth = (typeof SOURCE_HEALTH)[number];

/** Administrative levels (federal → state → LGA → ward). */
export const ADMIN_LEVELS = ["federal", "state", "lga", "ward"] as const;
export type AdminLevel = (typeof ADMIN_LEVELS)[number];

/** Evidence source kinds (hybrid retrieval, spec §21). */
export const EVIDENCE_SOURCE_TYPES = [
  "sql",
  "vector",
  "graph",
  "document",
] as const;
export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];

/** Citation edge relations in the legal dependency graph. */
export const CITATION_RELATIONS = [
  "CITES",
  "ENABLES",
  "RESTRICTS",
  "APPLIES_TO",
  "ADMINISTERED_BY",
] as const;
export type CitationRelation = (typeof CITATION_RELATIONS)[number];

/** Simulation engines (services/simulation). */
export const SIMULATION_ENGINES = [
  "forecast",
  "causal",
  "microsim",
  "abm",
  "system_dynamics",
  "optimization",
] as const;
export type SimulationEngine = (typeof SIMULATION_ENGINES)[number];

/** Review-task types for human-in-the-loop queues. */
export const REVIEW_TASK_TYPES = [
  "ocr_low_confidence",
  "legal_extract",
  "data_quality",
] as const;
export type ReviewTaskType = (typeof REVIEW_TASK_TYPES)[number];

/** Platform roles (spec §7 RBAC). */
export const PLATFORM_ROLES = [
  "executive",
  "policy_analyst",
  "legal_analyst",
  "simulation_specialist",
  "data_steward",
  "platform_admin",
] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/* ------------------------------------------------------------------ */
/* Standard response envelope (design.md §9)                           */
/* ------------------------------------------------------------------ */

export const API_VERSION = "v1" as const;

export interface EnvelopeMeta {
  request_id: string;
  correlation_id: string;
  api_version: typeof API_VERSION;
}

export interface EnvelopeAudit {
  actor_id: number | null;
  generated_at: Date;
}

export interface Envelope<T> {
  data: T;
  meta: EnvelopeMeta;
  audit: EnvelopeAudit;
}

/** Standard error envelope carried in TRPCError.cause. */
export interface ErrorEnvelope {
  code: string;
  message: string;
  request_id: string;
  retryable: boolean;
  details?: unknown;
}

/** Cursor-paginated list payload. */
export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

/* ------------------------------------------------------------------ */
/* Recommendation output contract (spec §9.2)                          */
/* ------------------------------------------------------------------ */

export interface BudgetRange {
  min: number;
  max: number;
  currency: "NGN";
  /** Unit of the figures, e.g. "million" — budgets are stated in ₦ millions. */
  unit: "million" | "billion";
}

export interface TimelinePhase {
  phase: string;
  start_month: number;
  duration_months: number;
  milestones: string[];
}

export interface RiskEntry {
  risk: string;
  likelihood: "low" | "medium" | "high";
  impact: "low" | "medium" | "high";
  mitigation: string;
}

export interface Kpi {
  key: string;
  label: string;
  baseline: number;
  target: number;
  unit: string;
  horizon_months: number;
}

export interface EvidenceRef {
  evidence_source_id: string;
  citation: string;
  confidence: number;
}

export interface Recommendation {
  recommendation_id: string;
  title: string;
  /** Why this intervention, grounded in the evidence base. */
  rationale: string;
  assumptions: string[];
  evidence_base: EvidenceRef[];
  estimated_jobs: { min: number; max: number; expected: number };
  budget_ranges: BudgetRange[];
  timeline: TimelinePhase[];
  implementation_actors: string[];
  legal_dependencies: { law_id: string; clause_ids: string[]; note: string }[];
  risk_register: RiskEntry[];
  kpis: Kpi[];
  simulation_scenarios: { scenario_id: string; engine: SimulationEngine }[];
  confidence: number;
  generated_at: Date;
}

/* ------------------------------------------------------------------ */
/* Simulation result shapes (uncertainty bands for charts)             */
/* ------------------------------------------------------------------ */

/** One point of a series with an 80% credible band. */
export interface BandPoint {
  /** Months since scenario start. */
  month: number;
  mean: number;
  lower: number;
  upper: number;
}

export interface SimulationResultSummary {
  engine: SimulationEngine;
  metric: string;
  unit: string;
  /** Monthly employment path (or engine-specific series) with 80% bands. */
  series: BandPoint[];
  /** Engine-specific extras (causal effect, distribution, portfolio...). */
  extras: Record<string, unknown>;
  seed: number;
  model_versions: Record<string, string>;
}

/* ------------------------------------------------------------------ */
/* Event topic catalog (spec §40)                                      */
/* ------------------------------------------------------------------ */

export const EventTopics = {
  ingestRawReceived: "ingest.raw.received",
  documentsParseRequested: "documents.parse.requested",
  graphIndexUpdated: "graph.index.updated",
  featuresMaterialized: "features.materialized",
  scenariosRunRequested: "scenarios.run.requested",
  simulationsRunCompleted: "simulations.run.completed",
  recommendationsGenerated: "recommendations.generated",
  reportsGenerated: "reports.generated",
  auditEvents: "audit.events",
  opsAlerts: "ops.alerts",
} as const;
export type EventTopic = (typeof EventTopics)[keyof typeof EventTopics];
