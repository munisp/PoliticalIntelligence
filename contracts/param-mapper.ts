import { z } from "zod";

/**
 * G3: legal-NLP → simulation-parameter mapper contracts.
 * Mirrors services/documents/app/param_mapper.py (deterministic, no LLM).
 */

export const PARAM_MAP_INSTRUMENTS = [
  "tax_credit",
  "subsidy",
  "grant",
  "procurement_quota",
  "training_levy",
  "regulatory_threshold",
  "penalty",
] as const;
export type ParamMapInstrument = (typeof PARAM_MAP_INSTRUMENTS)[number];

export const PARAM_MAP_SECTORS = [
  "agriculture",
  "manufacturing",
  "ICT",
  "construction",
  "energy",
  "health",
  "education",
] as const;
export type ParamMapSector = (typeof PARAM_MAP_SECTORS)[number];

export const PARAM_MAP_POPULATIONS = ["SME", "youth", "women"] as const;
export type ParamMapPopulation = (typeof PARAM_MAP_POPULATIONS)[number];

/** One clause text span that produced a mapped parameter. */
export const rationaleSpanSchema = z.object({
  clause_id: z.string(),
  section_path: z.string(),
  span: z.string(),
  parameter: z.string(),
});
export type RationaleSpan = z.infer<typeof rationaleSpanSchema>;

/** Candidate assumption set — always requires analyst review. */
export const assumptionCandidateSchema = z.object({
  instrument: z.enum(PARAM_MAP_INSTRUMENTS),
  scale_percent: z.number().nullable().optional(),
  amount_ngn: z.number().nullable().optional(),
  duration_months: z.number().int().nullable().optional(),
  sector: z.enum(PARAM_MAP_SECTORS).nullable().optional(),
  target_population: z.array(z.enum(PARAM_MAP_POPULATIONS)).default([]),
  confidence: z.number().min(0).max(1),
  rationale: z.array(rationaleSpanSchema).default([]),
  requires_analyst_review: z.literal(true),
});
export type AssumptionCandidate = z.infer<typeof assumptionCandidateSchema>;

export const paramMapResultSchema = z.object({
  candidates: z.array(assumptionCandidateSchema),
  clause_count: z.number().int().nonnegative(),
  requires_analyst_review: z.literal(true),
});
export type ParamMapResult = z.infer<typeof paramMapResultSchema>;

/** scenarios.mapBillToParameters input: a law or a source document. */
export const mapBillToParametersInput = z
  .object({
    law_id: z.string().min(1).optional(),
    document_id: z.string().min(1).optional(),
    top_k: z.number().int().min(1).max(25).default(10),
  })
  .refine((v) => v.law_id || v.document_id, {
    message: "law_id or document_id is required",
  });
export type MapBillToParametersInput = z.infer<typeof mapBillToParametersInput>;
