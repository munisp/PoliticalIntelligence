import { z } from "zod";
import { nanoid } from "nanoid";
import { REVIEW_STATES } from "@contracts/entities";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { envelope, apiError, audit } from "./utils/envelope";
import { requireRole } from "./utils/rbac";
import {
  findDocument,
  insertDocument,
  insertJob,
  listDocuments,
  listReviewTasks,
} from "./queries/admin";
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
    .query(async ({ ctx, input }) =>
      envelope(
        await listDocuments({
          jurisdictionId: input.jurisdiction_id,
          reviewState: input.review_state,
          language: input.language,
          confidenceBelow: input.confidence_below,
          cursor: input.cursor,
          limit: input.limit,
        }),
        ctx,
      ),
    ),

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
      return envelope(doc, ctx);
    }),

  /** Register a source document → async parse job. */
  register: authedQuery
    .input(
      z.object({
        document_id: z.string().min(1).optional(),
        title: z.string().min(3),
        jurisdiction_id: z.string().min(1),
        language: z.string().default("en"),
        source_uri: z.string().url().optional(),
        hash: z.string().optional(),
        doc_type: z.string().optional(),
        ocr_confidence: z.number().min(0).max(1).optional(),
        idempotency_key: z.string().min(8).max(128),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, ["data_steward", "policy_analyst"]);
      const documentId =
        input.document_id ??
        `doc:${input.jurisdiction_id.replace(/^jur:/, "")}:${nanoid(8)}`;
      await insertDocument({
        documentId,
        title: input.title,
        jurisdictionId: input.jurisdiction_id,
        language: input.language,
        sourceUri: input.source_uri ?? null,
        hash: input.hash ?? null,
        reviewState: "draft",
        docType: input.doc_type ?? null,
        ocrConfidence: input.ocr_confidence ?? null,
      });
      const jobId = `job:${nanoid(16)}`;
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
      audit(ctx, "documents.registered", {
        type: "document",
        id: documentId,
        scopes: ["documents:register"],
      });
      return envelope({ document_id: documentId, job_id: jobId, status: "queued" as const }, ctx);
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
