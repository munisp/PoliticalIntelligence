import { z } from "zod";
import {
  CITATION_RELATIONS,
  REVIEW_STATES,
  type ReviewState,
} from "@contracts/entities";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { envelope, apiError, audit } from "./utils/envelope";
import { requireRole, assertJurisdictionAccess, assertJurisdictionRead, resolveReadScope } from "./utils/rbac";
import { assertDatasetRead } from "./utils/datasets";
import {
  approvalEventsFor,
  citationTrace,
  clauseReviewQueue,
  clausesForLaw,
  findClause,
  findLaw,
  graphQuery,
  insertApprovalEvent,
  listLaws,
  updateClauseReviewState,
} from "./queries/legislation";
import { findDocument } from "./queries/admin";
import { computePolicyDiff } from "./lib/policy-diff";
import {
  CLAUSE_REVIEW_CONFIDENCE,
  type ClauseArtifact,
} from "@contracts/documents";
import {
  DocumentsServiceUnreachable,
  ensureReviewTask,
  fetchClausesArtifact,
  upsertClause,
  upsertLaw,
} from "./queries/documents";

/** Valid review-state transitions (spec §27). */
const TRANSITIONS: Record<ReviewState, ReviewState[]> = {
  draft: ["in_review"],
  in_review: ["approved", "returned"],
  approved: ["signed_off", "returned"],
  signed_off: [],
  returned: ["draft", "in_review"],
};

export const legislationRouter = createRouter({
  // ABAC-scoped read (SR-10/SEC-3): actors see laws in their assigned
  // jurisdictions only; executive/platform_admin see all.
  laws: publicQuery
    .input(
      z.object({
        jurisdiction_id: z.string().optional(),
        category: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const scope = await resolveReadScope(ctx, input.jurisdiction_id);
      return envelope(
        await listLaws({
          jurisdictionId: scope.jurisdictionId,
          jurisdictionIds: scope.jurisdictionIds,
          category: input.category,
          cursor: input.cursor,
          limit: input.limit,
        }),
        ctx,
      );
    }),

  law: publicQuery
    .input(z.object({ law_id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const law = await findLaw(input.law_id);
      if (!law)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "LAW_NOT_FOUND",
          message: `Law ${input.law_id} not found`,
        });
      await assertJurisdictionRead(ctx, law.jurisdictionId);
      const clauseCount = (await clausesForLaw(input.law_id)).length;
      return envelope({ ...law, clause_count: clauseCount }, ctx);
    }),

  clauses: publicQuery
    .input(z.object({ law_id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const law = await findLaw(input.law_id);
      if (law) await assertJurisdictionRead(ctx, law.jurisdictionId);
      // SEC-3: dataset-level ABAC — a restricted instrument's clauses are
      // forbidden to actors outside the policy's roles/jurisdiction.
      await assertDatasetRead(ctx, {
        entityType: "clause",
        datasetId: input.law_id,
        jurisdictionId: law?.jurisdictionId ?? null,
      });
      return envelope(await clausesForLaw(input.law_id), ctx);
    }),

  clause: publicQuery
    .input(z.object({ clause_id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const clause = await findClause(input.clause_id);
      if (!clause)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "CLAUSE_NOT_FOUND",
          message: `Clause ${input.clause_id} not found`,
        });
      const clauseLaw = await findLaw(clause.lawId);
      if (clauseLaw)
        await assertJurisdictionRead(ctx, clauseLaw.jurisdictionId);
      const [trace, approvals] = await Promise.all([
        citationTrace(input.clause_id),
        approvalEventsFor("clause", input.clause_id),
      ]);
      return envelope({ ...clause, citation_trace: trace, approval_history: approvals }, ctx);
    }),

  graphQuery: publicQuery
    .input(
      z
        .object({
          seed_clause_id: z.string().optional(),
          seed_law_id: z.string().optional(),
          relation: z.enum(CITATION_RELATIONS).optional(),
          depth: z.number().int().min(1).max(5).default(2),
        })
        .refine((v) => v.seed_clause_id || v.seed_law_id, {
          message: "seed_clause_id or seed_law_id is required",
        }),
    )
    .query(async ({ ctx, input }) => {
      // ABAC: assert read access on the seed law's jurisdiction.
      const seedLawId =
        input.seed_law_id ??
        (input.seed_clause_id
          ? (await findClause(input.seed_clause_id))?.lawId
          : undefined);
      if (seedLawId) {
        const law = await findLaw(seedLawId);
        if (law) await assertJurisdictionRead(ctx, law.jurisdictionId);
      }
      return envelope(
        await graphQuery({
          seedClauseId: input.seed_clause_id,
          seedLawId: input.seed_law_id,
          relation: input.relation,
          depth: input.depth,
        }),
        ctx,
      );
    }),

  /**
   * Clause-level comparison of two laws (SR-8). Reuses the deterministic
   * clause-alignment engine from the innovations policyDiff surface
   * (api/lib/policy-diff.ts) — identical inputs yield identical outputs.
   */
  compare: publicQuery
    .input(
      z.object({
        law_id_a: z.string().min(1),
        law_id_b: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { result, missingLawId } = await computePolicyDiff(
        input.law_id_a,
        input.law_id_b,
      );
      if (!result)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "LAW_NOT_FOUND",
          message: `Law ${missingLawId} not found`,
        });
      return envelope(result, ctx);
    }),

  reviewQueue: authedQuery
    .input(
      z.object({
        review_state: z.enum(REVIEW_STATES).optional(),
        low_confidence_only: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      requireRole(ctx, ["legal_analyst"]);
      return envelope(
        await clauseReviewQueue({
          reviewState: input.review_state,
          lowConfidenceOnly: input.low_confidence_only,
          limit: input.limit,
        }),
        ctx,
      );
    }),

  /** Legal-analyst review transition; emits approval_events + audit. */
  updateReviewState: authedQuery
    .input(
      z.object({
        clause_id: z.string().min(1),
        to_state: z.enum(REVIEW_STATES),
        comment: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, ["legal_analyst"]);
      const clause = await findClause(input.clause_id);
      if (!clause)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "CLAUSE_NOT_FOUND",
          message: `Clause ${input.clause_id} not found`,
        });
      const law = await findLaw(clause.lawId);
      if (law) {
        // ABAC: legal review is jurisdiction-scoped like other domains.
        await assertJurisdictionAccess(ctx, law.jurisdictionId, "write");
      }
      const from = clause.reviewState;
      const allowed = TRANSITIONS[from] ?? [];
      if (!allowed.includes(input.to_state))
        throw apiError(ctx, {
          http: "CONFLICT",
          code: "INVALID_TRANSITION",
          message: `Cannot move clause from ${from} to ${input.to_state}`,
          details: { from, allowed },
        });
      await updateClauseReviewState(input.clause_id, input.to_state);
      await insertApprovalEvent({
        entityType: "clause",
        entityId: input.clause_id,
        fromState: from,
        toState: input.to_state,
        actorId: ctx.user.id,
        comment: input.comment ?? null,
      });
      audit(ctx, "legislation.review_state.changed", {
        type: "clause",
        id: input.clause_id,
        scopes: ["legislation:review"],
        payload: { from_state: from, to_state: input.to_state },
      });
      const updated = await findClause(input.clause_id);
      return envelope(updated, ctx);
    }),

  /**
   * Import a processed law document (spec §18.6): idempotently creates /
   * updates laws + clauses rows from the documents service's clauses JSON.
   * Clauses below the BR-4 confidence floor are routed to review tasks.
   */
  importFromDocument: authedQuery
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
      if (doc.docType !== "law")
        throw apiError(ctx, {
          http: "BAD_REQUEST",
          code: "NOT_A_LAW_DOCUMENT",
          message: `Document ${input.document_id} has doc_type '${doc.docType}', expected 'law'`,
        });
      await assertJurisdictionAccess(ctx, doc.jurisdictionId, "write");

      let clauses: ClauseArtifact[];
      try {
        clauses = await fetchClausesArtifact(input.document_id);
      } catch (err) {
        if (err instanceof DocumentsServiceUnreachable)
          throw apiError(ctx, {
            http: "INTERNAL_SERVER_ERROR",
            code: "DOCUMENTS_SERVICE_UNREACHABLE",
            message: "documents service unreachable",
            retryable: true,
          });
        throw err;
      }

      const lawId = `law:${doc.jurisdictionId.replace(/^jur:/, "")}:${input.document_id.replace(/^doc:[^:]+:/, "")}`;
      const yearMatch = doc.title.match(/\b(19|20)\d{2}\b/);
      await upsertLaw({
        lawId,
        title: doc.title,
        jurisdictionId: doc.jurisdictionId,
        category: doc.docType,
        status: "in_force",
        year: yearMatch ? Number(yearMatch[0]) : null,
        sourceUri: doc.sourceUri,
      });

      let imported = 0;
      let reviewTaskCount = 0;
      for (const clause of clauses) {
        if (!clause.text.trim()) continue;
        const clauseId = `cls:${lawId}:${clause.section_path}`.slice(0, 96);
        await upsertClause({
          clauseId,
          lawId,
          sectionPath: clause.section_path,
          text: clause.text,
          language: doc.language,
          confidence: clause.confidence,
          reviewState: "draft",
          obligations: clause.obligations as never,
        });
        imported += 1;
        if (clause.confidence < CLAUSE_REVIEW_CONFIDENCE) {
          await ensureReviewTask({
            type: "legal_extract",
            entityRef: clauseId,
            assigneeRole: "legal_analyst",
            payload: {
              document_id: input.document_id,
              section_path: clause.section_path,
              confidence: clause.confidence,
              threshold: CLAUSE_REVIEW_CONFIDENCE,
            },
          });
          reviewTaskCount += 1;
        }
      }
      audit(ctx, "legislation.imported_from_document", {
        type: "law",
        id: lawId,
        scopes: ["legislation:import"],
        payload: {
          document_id: input.document_id,
          clauses_imported: imported,
          review_tasks: reviewTaskCount,
        },
      });
      return envelope(
        {
          law_id: lawId,
          document_id: input.document_id,
          clauses_imported: imported,
          review_tasks_created: reviewTaskCount,
        },
        ctx,
      );
    }),
});
