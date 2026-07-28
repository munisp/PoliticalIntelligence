import { z } from "zod";

/**
 * G4 — evidence-grounded bill drafting contracts.
 *
 * A draft law is assembled from an evidence base (simulation run,
 * opportunities, citations/evidence sources). Clause generation goes through
 * the LLM serving layer: the DEFAULT offline tier is a deterministic
 * structured synthesizer; a remote tier may replace it via configuration —
 * both MUST satisfy these contracts before persistence.
 */

/* ------------------------------------------------------------------ */
/* Evidence base                                                       */
/* ------------------------------------------------------------------ */

export const EvidenceBaseSchema = z.object({
  simulation_run_id: z.string().min(1).optional(),
  opportunity_ids: z.array(z.string().min(1)).max(20).optional(),
  /** Evidence-source / citation ids (ev:...). */
  citation_ids: z.array(z.string().min(1)).max(50).optional(),
});
export type EvidenceBase = z.infer<typeof EvidenceBaseSchema>;

/* ------------------------------------------------------------------ */
/* Generated clauses                                                   */
/* ------------------------------------------------------------------ */

/** Canonical drafting sections, in document order. */
export const DRAFT_SECTIONS = [
  "definitions",
  "instruments",
  "obligations",
  "enforcement",
  "commencement",
] as const;
export type DraftSection = (typeof DRAFT_SECTIONS)[number];

export const GROUNDING_KINDS = [
  "simulation_run",
  "opportunity",
  "citation",
] as const;
export type GroundingKind = (typeof GROUNDING_KINDS)[number];

/** One evidence pointer justifying a generated clause. */
export const ClauseGroundingSchema = z.object({
  kind: z.enum(GROUNDING_KINDS),
  id: z.string().min(1),
  /** Why this evidence justifies the clause. */
  note: z.string().min(1),
});
export type ClauseGrounding = z.infer<typeof ClauseGroundingSchema>;

export const DraftedClauseSchema = z.object({
  section: z.enum(DRAFT_SECTIONS),
  /** e.g. "s.1", "s.2" — document position. */
  section_path: z.string().min(1),
  heading: z.string().min(1),
  text: z.string().min(1),
  /** Every generated clause MUST record its evidence grounding. */
  grounding: z.array(ClauseGroundingSchema).min(1),
});
export type DraftedClause = z.infer<typeof DraftedClauseSchema>;

export const ClauseSetSchema = z.object({
  law_id: z.string().min(1),
  clauses: z.array(DraftedClauseSchema).min(1),
  model_routing: z.object({
    tier: z.enum(["remote", "offline-fallback"]),
    model: z.string(),
    fallback: z.boolean(),
    decided_at: z.string(),
  }),
});
export type ClauseSet = z.infer<typeof ClauseSetSchema>;

/* ------------------------------------------------------------------ */
/* Regulatory Impact Assessment annex                                  */
/* ------------------------------------------------------------------ */

export const RiaPointEstimateSchema = z.object({
  metric: z.string().min(1),
  unit: z.string().min(1),
  /** Point estimate at the projection horizon. */
  value: z.number(),
  /** 80% uncertainty band. */
  lower: z.number(),
  upper: z.number(),
  horizon_months: z.number().int().positive(),
});
export type RiaPointEstimate = z.infer<typeof RiaPointEstimateSchema>;

export const RiaAnnexSchema = z.object({
  simulation_run_id: z.string().min(1),
  scenario_id: z.string().min(1),
  engine: z.string().min(1),
  /** Plain-language consensus summary of the engine's projection. */
  consensus_summary: z.string().min(1),
  point_estimates: z.array(RiaPointEstimateSchema).min(1),
  assumptions: z.array(z.string().min(1)).min(1),
  /** sha256(manifest + result_summary) from the persisted run (DM-3). */
  reproducibility_hash: z.string().min(1),
  citations: z.array(
    z.object({
      evidence_source_id: z.string().min(1),
      citation: z.string().min(1),
    }),
  ),
  generated_at: z.string().min(1),
});
export type RiaAnnex = z.infer<typeof RiaAnnexSchema>;

/** Validate an unknown payload; returns human-readable error strings. */
export function validateClauseSetObject(obj: unknown): string[] {
  const r = ClauseSetSchema.safeParse(obj);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}

export function validateRiaAnnexObject(obj: unknown): string[] {
  const r = RiaAnnexSchema.safeParse(obj);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
}
