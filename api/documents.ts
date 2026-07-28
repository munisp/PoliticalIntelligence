import { z } from "zod";
import { nanoid } from "nanoid";
import { REVIEW_STATES } from "@contracts/entities";
import {
  CLAUSE_REVIEW_CONFIDENCE,
  MAX_DOCUMENT_BYTES,
  documentRegisterInput,
  type ProcessingMode,
} from "@contracts/documents";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { envelope, apiError, audit } from "./utils/envelope";
import { requireRole } from "./utils/rbac";
import { assertDatasetRead, filterDatasets } from "./utils/datasets";
import {
  findDocument,
  insertDocument,
  insertJob,
  listDocuments,
  listReviewTasks,
} from "./queries/admin";
import {
  DocumentsServiceUnreachable,
  fallbackProcess,
  fetchQuality,
  fetchServiceJob,
  fetchSourceUrl,
  reprocessDocument,
  runServicePipeline,
} from "./queries/documents";
import { enqueuePersistedJob } from "./runner";

export const documentsRouter = createRouter({
  list: publicQuery
    .input(
      z.object({
        jurisdiction_id: z.string().optional(),
        review_state: z.enum(REVIEW_STATES).optional(),
        language: z.string().optional(),
        confidence_below: z.number().min(0).max(1).optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const page = await listDocuments({
        jurisdictionId: input.jurisdiction_id,
        reviewState: input.review_state,
        language: input.language,
        confidenceBelow: input.confidence_below,
        cursor: input.cursor,
        limit: input.limit,
      });
      // SEC-3: dataset-level ABAC — restricted documents are hidden.
      const { visible, hidden } = await filterDatasets(ctx, page.items, (d) => ({
        entityType: "document",
        datasetId: d.documentId,
        jurisdictionId: d.jurisdictionId,
      }));
      return envelope({ ...page, items: visible, restricted_hidden: hidden }, ctx);
    }),

  get: publicQuery
    .input(z.object({ document_id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const doc = await findDocument(input.document_id);
      if (!doc)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "DOCUMENT_NOT_FOUND",
          message: `Document ${input.document_id} not found`,
        });
      // SEC-3: dataset-level ABAC — restricted documents are forbidden.
      await assertDatasetRead(ctx, {
        entityType: "document",
        datasetId: doc.documentId,
        jurisdictionId: doc.jurisdictionId,
      });
      return envelope(doc, ctx);
    }),

  /**
   * Register a source document → real processing pipeline (spec §18).
   * Accepts optional binary (base64 ≤10MB) or source_url to fetch; forwards
   * to services/documents (OCR → legal NLP → AKN). On service-unreachable,
   * a deterministic local fallback processor handles txt/md payloads and the
   * result is flagged `processing_mode: "fallback"`.
   */
  register: authedQuery
    .input(documentRegisterInput)
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, ["data_steward", "policy_analyst"]);
      const documentId =
        input.document_id ??
        `doc:${input.jurisdiction_id.replace(/^jur:/, "")}:${nanoid(8)}`;

      // Resolve binary payload (base64 upload, or fetch from source_url).
      let binary: Buffer | null = null;
      let filename = input.filename ?? "document.txt";
      if (input.content_base64) {
        binary = Buffer.from(input.content_base64, "base64");
        if (binary.length > MAX_DOCUMENT_BYTES)
          throw apiError(ctx, {
            http: "BAD_REQUEST",
            code: "PAYLOAD_TOO_LARGE",
            message: `Binary payload exceeds ${MAX_DOCUMENT_BYTES} bytes`,
          });
      } else if (input.source_url) {
        binary = await fetchSourceUrl(input.source_url, MAX_DOCUMENT_BYTES);
        filename =
          input.filename ??
          input.source_url.split("/").pop()?.split("?")[0] ??
          "document.bin";
      }

      let processingMode: ProcessingMode = "service";
      let serviceJobId: string | null = null;
      let ocrConfidence = input.ocr_confidence ?? null;
      let artifactUri = input.source_uri ?? null;
      let hash = input.hash ?? null;
      let reviewState: "draft" | "in_review" = "draft";
      let pipelineStatus: "queued" | "processed" | "fallback" = "queued";

      if (binary) {
        try {
          const job = await runServicePipeline({
            data: binary,
            filename,
            title: input.title,
            jurisdictionId: input.jurisdiction_id,
            docType: input.doc_type ?? "act",
            language: input.language,
            documentId,
            idempotencyKey: input.idempotency_key,
          });
          if (job.status === "failed")
            throw new DocumentsServiceUnreachable(job.error ?? "pipeline failed");
          serviceJobId = job.job_id;
          ocrConfidence = job.ocr_confidence ?? null;
          artifactUri = job.artifacts.raw ?? null;
          pipelineStatus = "processed";
          // Spec BR-4: low-confidence documents enter human review.
          if ((ocrConfidence ?? 1) < CLAUSE_REVIEW_CONFIDENCE)
            reviewState = "in_review";
        } catch (err) {
          if (!(err instanceof DocumentsServiceUnreachable)) throw err;
          const result = fallbackProcess(binary, filename);
          processingMode = "fallback";
          pipelineStatus = "fallback";
          ocrConfidence = result.ocr_confidence;
          hash = result.hash;
          reviewState = "in_review"; // fallback output always reviewed
        }
      }

      await insertDocument({
        documentId,
        title: input.title,
        jurisdictionId: input.jurisdiction_id,
        language: input.language,
        sourceUri: artifactUri,
        hash,
        reviewState,
        docType: input.doc_type ?? null,
        ocrConfidence,
      });
      const jobId = serviceJobId ?? `job:${nanoid(16)}`;
      if (!serviceJobId) {
        await insertJob({
          jobId,
          type: "documents.register",
          status: "queued",
          progress: 0,
          input: { document_id: documentId, actor_id: ctx.user.id },
          idempotencyKey: input.idempotency_key,
          actorId: ctx.user.id,
        });
        await enqueuePersistedJob(jobId);
      }
      audit(ctx, "documents.registered", {
        type: "document",
        id: documentId,
        scopes: ["documents:register"],
        payload: { processing_mode: processingMode },
      });
      return envelope(
        {
          document_id: documentId,
          job_id: jobId,
          status: pipelineStatus,
          processing_mode: processingMode,
          ocr_confidence: ocrConfidence,
          review_state: reviewState,
        },
        ctx,
      );
    }),

  /** Pipeline status — proxies the documents-service job (spec §18.5). */
  processingStatus: authedQuery
    .input(z.object({ job_id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const job = await fetchServiceJob(input.job_id).catch((err) => {
        if (err instanceof DocumentsServiceUnreachable)
          throw apiError(ctx, {
            http: "INTERNAL_SERVER_ERROR",
            code: "DOCUMENTS_SERVICE_UNREACHABLE",
            message: "documents service unreachable",
            retryable: true,
          });
        throw err;
      });
      return envelope(job, ctx);
    }),

  /** Quality report proxy (confidence distribution, review flags). */
  quality: authedQuery
    .input(z.object({ document_id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const report = await fetchQuality(input.document_id).catch((err) => {
        if (err instanceof DocumentsServiceUnreachable)
          throw apiError(ctx, {
            http: "INTERNAL_SERVER_ERROR",
            code: "DOCUMENTS_SERVICE_UNREACHABLE",
            message: "documents service unreachable",
            retryable: true,
          });
        throw err;
      });
      return envelope(report, ctx);
    }),

  /** Re-run the pipeline from the stored raw artifact (protected). */
  reprocess: authedQuery
    .input(z.object({ document_id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, ["legal_analyst", "data_steward"]);
      const doc = await findDocument(input.document_id);
      if (!doc)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "DOCUMENT_NOT_FOUND",
          message: `Document ${input.document_id} not found`,
        });
      const job = await reprocessDocument(input.document_id).catch((err) => {
        if (err instanceof DocumentsServiceUnreachable)
          throw apiError(ctx, {
            http: "INTERNAL_SERVER_ERROR",
            code: "DOCUMENTS_SERVICE_UNREACHABLE",
            message: "documents service unreachable — cannot reprocess",
            retryable: true,
          });
        throw err;
      });
      audit(ctx, "documents.reprocessed", {
        type: "document",
        id: input.document_id,
        scopes: ["documents:reprocess"],
      });
      return envelope(job, ctx);
    }),

  /** OCR low-confidence review queue (human-in-the-loop, spec §27). */
  ocrReviewQueue: authedQuery
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      requireRole(ctx, ["data_steward", "legal_analyst"]);
      const tasks = await listReviewTasks({
        type: "ocr_low_confidence",
        limit: input.limit,
      });
      return envelope(tasks, ctx);
    }),
});
