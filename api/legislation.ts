import { z } from "zod";
import {
  CITATION_RELATIONS,
  REVIEW_STATES,
  type ReviewState,
} from "@contracts/entities";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { envelope, apiError, audit } from "./utils/envelope";
import { requireRole } from "./utils/rbac";
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

/** Valid review-state transitions (spec §27). */
const TRANSITIONS: Record<ReviewState, ReviewState[]> = {
  draft: ["in_review"],
  in_review: ["approved", "returned"],
  approved: ["signed_off", "returned"],
  signed_off: [],
  returned: ["draft", "in_review"],
};

export const legislationRouter = createRouter({
  laws: publicQuery
    .input(
      z.object({
        jurisdiction_id: z.string().optional(),
        category: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) =>
      envelope(
        await listLaws({
          jurisdictionId: input.jurisdiction_id,
          category: input.category,
          cursor: input.cursor,
          limit: input.limit,
        }),
        ctx,
      ),
    ),

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
      const clauseCount = (await clausesForLaw(input.law_id)).length;
      return envelope({ ...law, clause_count: clauseCount }, ctx);
    }),

  clauses: publicQuery
    .input(z.object({ law_id: z.string().min(1) }))
    .query(async ({ ctx, input }) =>
      envelope(await clausesForLaw(input.law_id), ctx),
    ),

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
    .query(async ({ ctx, input }) =>
      envelope(
        await graphQuery({
          seedClauseId: input.seed_clause_id,
          seedLawId: input.seed_law_id,
          relation: input.relation,
          depth: input.depth,
        }),
        ctx,
      ),
    ),

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
});
