/**
 * Document & legal pipeline contracts (spec §18) — shared between
 * api/documents.ts, api/legislation.ts and the documents service bridge.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Requests                                                            */
/* ------------------------------------------------------------------ */

/** documents.register input extension: binary (base64 ≤10MB) or source_url. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export const documentRegisterInput = z.object({
  document_id: z.string().min(1).optional(),
  title: z.string().min(3),
  jurisdiction_id: z.string().min(1),
  language: z.string().default("en"),
  source_uri: z.string().url().optional(),
  /** Fetch the binary from this URL (service fetches, not the API). */
  source_url: z.string().url().optional(),
  /** Base64-encoded binary payload (≤10MB decoded). */
  content_base64: z.string().max(14_000_000).optional(),
  filename: z.string().min(1).max(255).optional(),
  hash: z.string().optional(),
  doc_type: z.string().optional(),
  ocr_confidence: z.number().min(0).max(1).optional(),
  idempotency_key: z.string().min(8).max(128),
});
export type DocumentRegisterInput = z.infer<typeof documentRegisterInput>;

/* ------------------------------------------------------------------ */
/* Documents-service responses (validated at the boundary)             */
/* ------------------------------------------------------------------ */

export const stageStatusSchema = z.object({
  name: z.string(),
  status: z.enum(["pending", "running", "succeeded", "failed", "skipped"]),
  detail: z.string().nullable().optional(),
});
export type StageStatus = z.infer<typeof stageStatusSchema>;

export const serviceJobSchema = z.object({
  job_id: z.string(),
  document_id: z.string(),
  status: z.enum(["queued", "running", "succeeded", "failed"]),
  error: z.string().nullable().optional(),
  stages: z.array(stageStatusSchema).default([]),
  artifacts: z.record(z.string(), z.string()).default({}),
  ocr_confidence: z.number().nullable().optional(),
  processing_mode: z.string().default("full"),
  review_flags: z.array(z.record(z.string(), z.unknown())).default([]),
});
export type ServiceJob = z.infer<typeof serviceJobSchema>;

export const qualityReportSchema = z.object({
  document_id: z.string(),
  page_count: z.number(),
  mean_ocr_confidence: z.number(),
  confidence_distribution: z.record(z.string(), z.number()),
  low_confidence_pages: z.array(z.number()),
  backend_used: z.string(),
  fallback_used: z.boolean(),
  clause_count: z.number(),
  obligation_count: z.number(),
  defined_term_count: z.number(),
  citation_count: z.number(),
  review_flags: z.array(z.record(z.string(), z.unknown())),
});
export type QualityReport = z.infer<typeof qualityReportSchema>;

export const obligationSchema = z.object({
  kind: z.enum(["obligation", "prohibition", "permission"]),
  actor: z.string().nullable().optional(),
  action: z.string(),
  condition: z.string().nullable().optional(),
  modal: z.string(),
});

export const citationSchema = z.object({
  raw: z.string(),
  target_title: z.string().nullable().optional(),
  target_year: z.number().nullable().optional(),
  section_ref: z.string().nullable().optional(),
  relation: z.enum(["CITES", "AMENDS", "REPEALS", "ENABLES", "RESTRICTS"]),
});

export const clauseArtifactSchema = z.object({
  clause_id: z.string(),
  section_path: z.string(),
  heading: z.string().nullable().optional(),
  text: z.string(),
  kind: z.enum(["section", "definition", "proviso", "schedule", "preamble"]),
  confidence: z.number(),
  obligations: z.array(obligationSchema).default([]),
  defined_terms: z.array(z.string()).default([]),
  citations: z.array(citationSchema).default([]),
});
export type ClauseArtifact = z.infer<typeof clauseArtifactSchema>;

/* ------------------------------------------------------------------ */
/* API-level outputs                                                   */
/* ------------------------------------------------------------------ */

export const PROCESSING_MODES = ["service", "fallback"] as const;
export type ProcessingMode = (typeof PROCESSING_MODES)[number];

export const CLAUSE_REVIEW_CONFIDENCE = 0.75; // spec BR-4
