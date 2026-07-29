import { z } from "zod";

/**
 * I4 — legislative diff-impact contracts (docs/INNOVATIONS.md §I4).
 * Mirrors services/documents/app/diff_impact.py; the API bridges the
 * documents service and falls back to an in-process deterministic engine
 * (api/lib/diff-impact.ts) with the same output shape.
 */

export const obligationChangeSchema = z.object({
  change: z.enum(["added", "removed", "changed"]),
  section_path: z.string(),
  kind: z.string(),
  actor: z.string().nullable(),
  action_a: z.string().nullable(),
  action_b: z.string().nullable(),
  impact_note: z.string(),
});
export type ObligationChange = z.infer<typeof obligationChangeSchema>;

export const parameterDeltaSchema = z.object({
  instrument: z.string(),
  sector: z.string().nullable(),
  field: z.string(),
  change: z.enum(["added", "removed", "changed"]),
  value_a: z.union([z.number(), z.string()]).nullable(),
  value_b: z.union([z.number(), z.string()]).nullable(),
  delta: z.number().nullable(),
  impact_note: z.string(),
});
export type ParameterDelta = z.infer<typeof parameterDeltaSchema>;

export const diffImpactResultSchema = z.object({
  clauses_a: z.number().int().nonnegative(),
  clauses_b: z.number().int().nonnegative(),
  aligned_pairs: z.number().int().nonnegative(),
  obligations_added: z.number().int().nonnegative(),
  obligations_removed: z.number().int().nonnegative(),
  obligations_changed: z.number().int().nonnegative(),
  obligation_changes: z.array(obligationChangeSchema),
  parameter_deltas: z.array(parameterDeltaSchema),
  requires_analyst_review: z.boolean(),
});
export type DiffImpactResult = z.infer<typeof diffImpactResultSchema>;

/** Clause payload accepted inline (docA/docB) or derived from laws. */
export const diffClauseSchema = z.object({
  clause_id: z.string(),
  section_path: z.string(),
  text: z.string(),
  obligations: z
    .array(
      z.object({
        kind: z.string().default("obligation"),
        actor: z.string().nullable().default(null),
        action: z.string(),
        modal: z.string().default("shall"),
      }),
    )
    .default([]),
});
export type DiffClause = z.infer<typeof diffClauseSchema>;

export const diffImpactInput = z
  .object({
    fromLawId: z.string().min(1).optional(),
    toLawId: z.string().min(1).optional(),
    docA: z.object({ clauses: z.array(diffClauseSchema).min(1) }).optional(),
    docB: z.object({ clauses: z.array(diffClauseSchema).min(1) }).optional(),
  })
  .refine(
    (v) => (v.fromLawId && v.toLawId) || (v.docA && v.docB),
    { message: "Provide fromLawId+toLawId or docA+docB" },
  );
export type DiffImpactInput = z.infer<typeof diffImpactInput>;

export const diffImpactOutput = diffImpactResultSchema.extend({
  /** Which engine produced the result (honesty marker). */
  engine: z.enum(["documents-service", "fallback"]),
});
export type DiffImpactOutput = z.infer<typeof diffImpactOutput>;
