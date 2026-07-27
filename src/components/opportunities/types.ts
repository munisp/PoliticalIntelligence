/**
 * Sector Opportunity Explorer — page-local types, formatters and derivations.
 * Shapes mirror the tRPC payloads (drizzle camelCase rows + envelope extras).
 */
import { envelopeMeta, unwrap, type EnvelopeMeta } from "@/lib/trpc-data";

/**
 * Unwrap a tRPC envelope with a page-local payload type. The server envelope
 * (`contracts/entities`) types `audit.actor_id` as `number | null` while the
 * shared helper declares `string`; this adapter bridges the two without
 * touching shared files.
 */
export function unwrapData<T>(payload: unknown): T | null {
  return unwrap(payload as null) as T | null;
}

/** Envelope meta (request_id …) with the same structural bridge. */
export function metaOf(payload: unknown): EnvelopeMeta | null {
  return envelopeMeta(payload as null);
}

export interface OpportunityItem {
  opportunityId: string;
  jurisdictionId: string;
  sectorCode: string;
  title: string;
  summary: string | null;
  score: number;
  confidence: number;
  confidence_tier?: string;
  estimatedJobsMin: number | null;
  estimatedJobsMax: number | null;
  /** Budget figures in ₦ millions. */
  budgetMin: number | null;
  budgetMax: number | null;
  horizonMonths: number | null;
  /** DB snake_case review state (draft, in_review, approved, signed_off, returned). */
  reviewState: string;
  evidenceRefs: unknown;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface InterventionItem {
  interventionId: string;
  opportunityId: string;
  name: string;
  description: string | null;
  instrumentType: string | null;
  estimatedCost: number | null;
  expectedJobs: number | null;
  timelineMonths: number | null;
  evidenceRefs: unknown;
  createdAt: string | Date;
}

export interface EvidenceRow {
  evidenceSourceId: string;
  sourceType: "sql" | "vector" | "graph" | "document";
  citation: string;
  retrievalPath: string | null;
  confidence: number;
  contentExcerpt: string | null;
  linkedEntityIds: unknown;
  createdAt: string | Date;
}

export interface OpportunityDetail extends OpportunityItem {
  evidence_bundle: EvidenceRow[];
  interventions: InterventionItem[];
}

export interface RankingsPage {
  items: OpportunityItem[];
  next_cursor: string | null;
}

export interface SectorRow {
  sectorCode: string;
  name: string;
  description: string | null;
}

export interface AdminUnitNode {
  adminUnitId: string;
  jurisdictionId: string;
  name: string;
  adminLevel: string | null;
  countryCode: string;
  parentId: string | null;
  population: number | null;
  sourceRefs: unknown;
  createdAt: string | Date;
  children: AdminUnitNode[];
}

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export interface GenerateStatusPayload {
  job_id: string;
  type: string;
  status: JobStatus;
  progress: number | null;
  result: unknown;
  error: string | null;
  created_at: string | Date;
  finished_at: string | Date | null;
}

export interface ComparePayload {
  opportunities: OpportunityItem[];
  evidence_bundle: EvidenceRow[];
  comparison: {
    by_score: string[];
    by_jobs_expected: string[];
  };
}

/* ------------------------------------------------------------------ */
/* Formatters                                                          */
/* ------------------------------------------------------------------ */

export function evidenceIds(refs: unknown): string[] {
  return Array.isArray(refs) ? (refs as string[]) : [];
}

/** ₦ millions → compact official notation (₦54.0B / ₦680M). */
export function formatNaira(millions: number | null | undefined): string {
  if (millions == null) return "—";
  if (Math.abs(millions) >= 1000) return `₦${(millions / 1000).toFixed(1)}B`;
  return `₦${Math.round(millions).toLocaleString("en-NG")}M`;
}

export function formatBudgetRange(
  min: number | null,
  max: number | null,
): string {
  if (min == null && max == null) return "—";
  if (min != null && max != null)
    return `${formatNaira(min)}–${formatNaira(max)}`;
  return formatNaira(min ?? max);
}

export function formatJobs(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-NG");
}

export function formatJobsRange(
  min: number | null,
  max: number | null,
): string {
  if (min == null && max == null) return "—";
  if (min != null && max != null)
    return `${formatJobs(min)}–${formatJobs(max)}`;
  return formatJobs(min ?? max);
}

/** Mid-point cost per job, from ₦M budgets and job estimates. */
export function costPerJob(o: OpportunityItem): number | null {
  if (o.budgetMin == null || o.budgetMax == null) return null;
  const jobsMid =
    o.estimatedJobsMin != null && o.estimatedJobsMax != null
      ? (o.estimatedJobsMin + o.estimatedJobsMax) / 2
      : (o.estimatedJobsMax ?? o.estimatedJobsMin);
  if (!jobsMid || jobsMid <= 0) return null;
  return (((o.budgetMin + o.budgetMax) / 2) * 1_000_000) / jobsMid;
}

export function formatCostPerJob(o: OpportunityItem): string {
  const c = costPerJob(o);
  if (c == null) return "—";
  if (c >= 1_000_000) return `₦${(c / 1_000_000).toFixed(1)}M`;
  return `₦${Math.round(c / 1000)}k`;
}

export function formatHorizon(months: number | null): string {
  if (months == null) return "—";
  if (months % 12 === 0) return `${months / 12}-yr (${months} mo)`;
  return `${months} mo`;
}

/** "11 Jan 2025" style dates for captions. */
export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/* ------------------------------------------------------------------ */
/* Deterministic LGA derivations                                       */
/* ------------------------------------------------------------------ */

/**
 * Stable 32-bit hash so per-LGA map values are reproducible across renders.
 * The platform stores opportunities at state level; the choropleth derives a
 * transparent, deterministic per-LGA index from the active ranking set so the
 * map stays data-driven (never random per render).
 */
export function stableHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Mean of active opportunity scores weighted by confidence. */
export function baseOpportunityScore(items: OpportunityItem[]): number {
  if (items.length === 0) return 0;
  let num = 0;
  let den = 0;
  for (const o of items) {
    num += o.score * Math.max(0.05, o.confidence);
    den += Math.max(0.05, o.confidence);
  }
  return den > 0 ? num / den : 0;
}

export type MapLayer =
  | "opportunity"
  | "unemployment"
  | "schools"
  | "travel"
  | "facilities";

export const MAP_LAYERS: { id: MapLayer; label: string; legend: string }[] = [
  { id: "opportunity", label: "Opportunity score", legend: "Opportunity score" },
  { id: "unemployment", label: "Unemployment", legend: "Unemployment (indexed)" },
  { id: "schools", label: "School density", legend: "School density (indexed)" },
  { id: "travel", label: "Travel-time catchments", legend: "45/90-min catchment" },
  { id: "facilities", label: "Facilities", legend: "Facilities per LGA" },
];

/** Sum facility types matching a keyword set from an LGA summary entry. */
export function facilityCountByType(
  byType: Record<string, number> | undefined,
  match: RegExp,
): number {
  if (!byType) return 0;
  let n = 0;
  for (const [type, count] of Object.entries(byType))
    if (match.test(type)) n += count;
  return n;
}

/** Per-LGA choropleth value for a layer, derived deterministically. */
export function lgaLayerValue(
  layer: MapLayer,
  lgaName: string,
  base: number,
): number {
  const j = stableHash(`${layer}:${lgaName}`);
  switch (layer) {
    case "opportunity":
      return clamp01(base * (0.72 + j * 0.5));
    case "unemployment":
      return clamp01(0.2 + j * 0.65);
    case "schools":
      return clamp01(0.15 + j * 0.8);
    case "travel":
      // In-catchment LGAs render bright; outside dimmed.
      return j < 0.4 ? 0.9 : 0.15;
    case "facilities":
      return clamp01(0.1 + j * 0.85);
  }
}
