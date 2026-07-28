import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as schema from "@db/schema";
import type { ReviewState } from "@contracts/entities";
import {
  clauseArtifactSchema,
  qualityReportSchema,
  serviceJobSchema,
  type ClauseArtifact,
  type ProcessingMode,
  type QualityReport,
  type ServiceJob,
} from "@contracts/documents";
import { getDb } from "./connection";

/* ------------------------------------------------------------------ */
/* Row updates                                                         */
/* ------------------------------------------------------------------ */

export async function updateDocumentState(
  documentId: string,
  reviewState: ReviewState,
) {
  await getDb()
    .update(schema.policyDocuments)
    .set({ reviewState })
    .where(eq(schema.policyDocuments.documentId, documentId));
}

/** Persist pipeline outcome on the document row (spec §18.5). */
export async function updateDocumentProcessing(
  documentId: string,
  patch: {
    ocrConfidence?: number | null;
    reviewState?: ReviewState;
    artifactUri?: string | null;
    hash?: string | null;
  },
) {
  const set: Partial<typeof schema.policyDocuments.$inferInsert> = {};
  if (patch.ocrConfidence !== undefined) set.ocrConfidence = patch.ocrConfidence;
  if (patch.reviewState !== undefined) set.reviewState = patch.reviewState;
  if (patch.artifactUri !== undefined) set.sourceUri = patch.artifactUri;
  if (patch.hash !== undefined) set.hash = patch.hash;
  if (Object.keys(set).length === 0) return;
  await getDb()
    .update(schema.policyDocuments)
    .set(set)
    .where(eq(schema.policyDocuments.documentId, documentId));
}

export async function insertReviewTask(
  row: typeof schema.reviewTasks.$inferInsert,
) {
  await getDb().insert(schema.reviewTasks).values(row);
}

/** Idempotent review-task creation (skip when an open task already exists
 * for the same entity + type). */
export async function ensureReviewTask(opts: {
  type: "ocr_low_confidence" | "legal_extract" | "data_quality";
  entityRef: string;
  assigneeRole: string;
  payload?: unknown;
}) {
  const existing = await getDb().query.reviewTasks.findFirst({
    where: and(
      eq(schema.reviewTasks.type, opts.type),
      eq(schema.reviewTasks.entityRef, opts.entityRef),
      eq(schema.reviewTasks.status, "open"),
    ),
  });
  if (existing) return { taskId: existing.taskId, created: false };
  const taskId = `task:${nanoid(10)}`;
  await insertReviewTask({
    taskId,
    type: opts.type,
    entityRef: opts.entityRef,
    assigneeRole: opts.assigneeRole,
    status: "open",
    payload: (opts.payload ?? null) as never,
  });
  return { taskId, created: true };
}

/* ------------------------------------------------------------------ */
/* Legislation upserts (importFromDocument) — idempotent by fixed ids  */
/* ------------------------------------------------------------------ */

export async function upsertLaw(
  row: typeof schema.laws.$inferInsert,
) {
  await getDb()
    .insert(schema.laws)
    .values(row)
    .onDuplicateKeyUpdate({
      set: { title: row.title, category: row.category, year: row.year },
    });
}

export async function upsertClause(
  row: typeof schema.clauses.$inferInsert,
) {
  await getDb()
    .insert(schema.clauses)
    .values(row)
    .onDuplicateKeyUpdate({
      set: {
        text: row.text,
        confidence: row.confidence,
        obligations: row.obligations,
      },
    });
}

/* ------------------------------------------------------------------ */
/* Documents-service bridge (spec §18)                                 */
/* ------------------------------------------------------------------ */

export const DOCUMENTS_BASE_URL =
  process.env.DOCUMENTS_BASE_URL ?? "http://localhost:8400";
const TIMEOUT_MS = 5000;
const POLL_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 400;

export class DocumentsServiceUnreachable extends Error {
  constructor(message = "documents service unreachable") {
    super(message);
    this.name = "DocumentsServiceUnreachable";
  }
}

async function fetchJson<T>(
  path: string,
  init: RequestInit,
  schemaOut: { parse(v: unknown): T },
  timeoutMs = TIMEOUT_MS,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(`${DOCUMENTS_BASE_URL}${path}`, {
      ...init,
      signal: ctrl.signal,
    });
    if (!resp.ok) throw new Error(`documents service ${resp.status}`);
    const body = (await resp.json()) as { data?: unknown };
    return schemaOut.parse(body.data ?? body);
  } catch (err) {
    if (err instanceof Error && /documents service \d+/.test(err.message))
      throw err;
    throw new DocumentsServiceUnreachable(
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Upload binary → service job; polls until the pipeline finishes. */
export async function runServicePipeline(opts: {
  data: Buffer;
  filename: string;
  title: string;
  jurisdictionId: string;
  docType: string;
  language: string;
  documentId?: string;
  idempotencyKey: string;
}): Promise<ServiceJob> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(opts.data)]),
    opts.filename,
  );
  form.append("title", opts.title);
  form.append("jurisdiction_id", opts.jurisdictionId);
  form.append("doc_type", opts.docType);
  form.append("language", opts.language);
  if (opts.documentId) form.append("document_id", opts.documentId);
  const submitted = await fetchJson(
    "/v1/documents",
    {
      method: "POST",
      headers: { "Idempotency-Key": opts.idempotencyKey },
      body: form,
    },
    { parse: (v) => v as { job_id: string; document_id: string } },
  );
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const job = await fetchJson(
      `/v1/documents/${submitted.document_id}`,
      { method: "GET" },
      serviceJobSchema,
    );
    if (job.status === "succeeded" || job.status === "failed") return job;
    if (Date.now() > deadline)
      throw new DocumentsServiceUnreachable("pipeline poll timeout");
  }
}

export async function fetchServiceJob(
  jobOrDocumentId: string,
): Promise<ServiceJob> {
  return fetchJson(`/v1/documents/${jobOrDocumentId}`, { method: "GET" },
    serviceJobSchema);
}

export async function fetchQuality(
  documentId: string,
): Promise<QualityReport> {
  return fetchJson(`/v1/documents/${documentId}/quality`, { method: "GET" },
    qualityReportSchema);
}

export async function fetchClausesArtifact(
  documentId: string,
): Promise<ClauseArtifact[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(
      `${DOCUMENTS_BASE_URL}/v1/documents/${documentId}/artifacts/clauses`,
      { signal: ctrl.signal },
    );
    if (!resp.ok) throw new Error(`documents service ${resp.status}`);
    return clauseArtifactSchema.array().parse(await resp.json());
  } catch (err) {
    if (err instanceof Error && /documents service \d+/.test(err.message))
      throw err;
    throw new DocumentsServiceUnreachable(
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function reprocessDocument(
  documentId: string,
): Promise<ServiceJob> {
  return fetchJson(
    `/v1/documents/${documentId}/reprocess`,
    { method: "POST" },
    { parse: (v) => v as ServiceJob },
  );
}

/* ------------------------------------------------------------------ */
/* Deterministic local fallback processor (service unreachable)        */
/* ------------------------------------------------------------------ */

export interface FallbackProcessingResult {
  processing_mode: ProcessingMode;
  text: string;
  ocr_confidence: number;
  hash: string;
  clause_count: number;
  note: string;
}

/**
 * Basic text extraction for txt/md payloads — deterministic, no network.
 * Binary formats (pdf/docx/images) are rejected here; they require the
 * documents service OCR backends.
 */
export function fallbackProcess(data: Buffer, filename: string): FallbackProcessingResult {
  const hash = createHash("sha256").update(data).digest("hex");
  const lower = filename.toLowerCase();
  if (!lower.endsWith(".txt") && !lower.endsWith(".md")) {
    throw new Error(
      "fallback processor supports only .txt/.md payloads; start the documents service for OCR",
    );
  }
  const text = data.toString("utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  // Section-number heuristic mirrors services/documents legal segmentation.
  const clauses = lines.filter((l) => /^\s*\d{1,3}\s*[.–—-]/.test(l)).length;
  // Confidence heuristic: printable-ratio based, capped below review floor
  // so fallback output always routes through human review (spec BR-4).
  const printable = text.replace(/[^\x20-\x7E\n\t]/g, "").length;
  const ratio = text.length > 0 ? printable / text.length : 0;
  const ocrConfidence = Math.min(0.7, Math.round(ratio * 100) / 100 * 0.7);
  return {
    processing_mode: "fallback",
    text,
    ocr_confidence: Math.round(ocrConfidence * 1000) / 1000,
    hash,
    clause_count: clauses,
    note: "documents service unreachable — deterministic local extraction",
  };
}

/** Fetch a remote document binary (source_url) with size guard. */
export async function fetchSourceUrl(url: string, maxBytes: number): Promise<Buffer> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: ctrl.signal });
    if (!resp.ok) throw new Error(`source fetch ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length > maxBytes)
      throw new Error(`source exceeds ${maxBytes} bytes`);
    return buf;
  } finally {
    clearTimeout(timer);
  }
}
