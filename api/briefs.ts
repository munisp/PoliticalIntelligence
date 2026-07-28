import { z } from "zod";
import { nanoid } from "nanoid";
import { REVIEW_STATES, type ReviewState } from "@contracts/entities";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { envelope, apiError, audit, requestMeta } from "./utils/envelope";
import { requireRole, requireSignOff, assertJurisdictionAccess, assertJurisdictionRead, resolveReadScope } from "./utils/rbac";
import { findBrief, insertBrief, listBriefs, updateBrief } from "./queries/briefs";
import { insertApprovalEvent, approvalEventsFor } from "./queries/legislation";
import { insertJob } from "./queries/admin";
import { listExportEvents, insertAuditEvent } from "./queries/audit";
import { enqueuePersistedJob } from "./runner";

const TRANSITIONS: Record<ReviewState, ReviewState[]> = {
  draft: ["in_review"],
  in_review: ["approved", "returned"],
  approved: ["signed_off", "returned"],
  signed_off: [],
  returned: ["draft", "in_review"],
};

async function transitionBrief(
  ctx: Parameters<typeof audit>[0] & { user: { id: number } },
  briefId: string,
  toState: ReviewState,
  comment?: string,
) {
  const brief = await findBrief(briefId);
  if (!brief)
    throw apiError(ctx, {
      http: "NOT_FOUND",
      code: "BRIEF_NOT_FOUND",
      message: `Brief ${briefId} not found`,
    });
  await assertJurisdictionAccess(ctx as never, brief.jurisdictionId, "write");
  const from = brief.reviewState;
  if (!(TRANSITIONS[from] ?? []).includes(toState))
    throw apiError(ctx, {
      http: "CONFLICT",
      code: "INVALID_TRANSITION",
      message: `Cannot move brief from ${from} to ${toState}`,
      details: { from, allowed: TRANSITIONS[from] },
    });
  await updateBrief(briefId, {
    reviewState: toState,
    ...(toState === "approved" ? { approvedBy: ctx.user.id } : {}),
    ...(toState === "signed_off" ? { signedOffAt: new Date() } : {}),
  });
  await insertApprovalEvent({
    entityType: "brief",
    entityId: briefId,
    fromState: from,
    toState,
    actorId: ctx.user.id,
    comment: comment ?? null,
  });
  audit(ctx, `briefs.${toState}`, {
    type: "brief",
    id: briefId,
    scopes: ["briefs:approve"],
    payload: { from_state: from, to_state: toState },
  });
  return findBrief(briefId);
}

export const briefsRouter = createRouter({
  // ABAC-scoped read (SR-10/SEC-3): actors see briefs in their assigned
  // jurisdictions only; executive/platform_admin see all.
  list: publicQuery
    .input(
      z.object({
        jurisdiction_id: z.string().optional(),
        review_state: z.enum(REVIEW_STATES).optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const scope = await resolveReadScope(ctx, input.jurisdiction_id);
      return envelope(
        await listBriefs({
          jurisdictionId: scope.jurisdictionId,
          jurisdictionIds: scope.jurisdictionIds,
          reviewState: input.review_state,
          cursor: input.cursor,
          limit: input.limit,
        }),
        ctx,
      );
    }),

  get: publicQuery
    .input(z.object({ brief_id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const brief = await findBrief(input.brief_id);
      if (!brief)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "BRIEF_NOT_FOUND",
          message: `Brief ${input.brief_id} not found`,
        });
      await assertJurisdictionRead(ctx, brief.jurisdictionId);
      const approvals = await approvalEventsFor("brief", input.brief_id);
      return envelope({ ...brief, approval_history: approvals }, ctx);
    }),

  /** Async brief generation (policy_analyst) → job → structured content. */
  generate: authedQuery
    .input(
      z.object({
        brief_id: z.string().min(1).optional(),
        jurisdiction_id: z.string().min(1),
        template: z.enum(["executive_memo", "sector_brief", "scenario_summary"]).default("executive_memo"),
        title: z.string().min(3),
        opportunity_ids: z.array(z.string()).max(10).default([]),
        idempotency_key: z.string().min(8).max(128),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, ["policy_analyst"]);
      await assertJurisdictionAccess(ctx, input.jurisdiction_id, "write");
      const briefId =
        input.brief_id ??
        `brf:${input.jurisdiction_id.replace(/^jur:/, "")}:${nanoid(8)}`;
      await insertBrief({
        briefId,
        jurisdictionId: input.jurisdiction_id,
        template: input.template,
        title: input.title,
        reviewState: "draft",
        content: null,
        modelRouting: null,
        requestId: requestMeta(ctx).request_id,
        createdBy: ctx.user.id,
      });
      const jobId = `job:${nanoid(16)}`;
      await insertJob({
        jobId,
        type: "briefs.generate",
        status: "queued",
        progress: 0,
        input: {
          brief_id: briefId,
          actor_id: ctx.user.id,
          opportunity_ids: input.opportunity_ids,
        },
        idempotencyKey: input.idempotency_key,
        actorId: ctx.user.id,
      });
      await enqueuePersistedJob(jobId);
      audit(ctx, "briefs.generate.requested", {
        type: "brief",
        id: briefId,
        scopes: ["briefs:generate"],
      });
      return envelope({ brief_id: briefId, job_id: jobId, status: "queued" as const }, ctx);
    }),

  approve: authedQuery
    .input(
      z.object({
        brief_id: z.string().min(1),
        comment: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, ["policy_analyst", "executive"]);
      return envelope(
        await transitionBrief(ctx, input.brief_id, "approved", input.comment),
        ctx,
      );
    }),

  return: authedQuery
    .input(
      z.object({
        brief_id: z.string().min(1),
        comment: z.string().min(1).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, ["policy_analyst", "executive"]);
      return envelope(
        await transitionBrief(ctx, input.brief_id, "returned", input.comment),
        ctx,
      );
    }),

  /** Executive-only sign-off (gold seal). */
  signOff: authedQuery
    .input(
      z.object({
        brief_id: z.string().min(1),
        comment: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireSignOff(ctx);
      return envelope(
        await transitionBrief(ctx, input.brief_id, "signed_off", input.comment),
        ctx,
      );
    }),

  /** Export metadata + records the export audit event (spec §27). */
  exportMeta: authedQuery
    .input(
      z.object({
        brief_id: z.string().min(1),
        format: z.enum(["memo_docx", "brief_pdf", "presentation_pptx", "print"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const brief = await findBrief(input.brief_id);
      if (!brief)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "BRIEF_NOT_FOUND",
          message: `Brief ${input.brief_id} not found`,
        });
      if (input.format) {
        // Record this export synchronously so the returned history includes it.
        const meta = requestMeta(ctx);
        await insertAuditEvent({
          actorId: ctx.user.id,
          action: "briefs.exported",
          entityType: "brief",
          entityId: input.brief_id,
          scopes: ["briefs:export"],
          requestId: meta.request_id,
          correlationId: meta.correlation_id,
          payload: {
            topic: "audit.events",
            data: {
              format: input.format,
              review_state: brief.reviewState,
              request_id: meta.request_id,
            },
          },
        });
      }
      const exports = await listExportEvents("brief", input.brief_id);
      return envelope(
        {
          brief_id: input.brief_id,
          last_exports: exports.map((e) => ({
            format: (e.payload as { data?: { format?: string } } | null)?.data?.format ?? "unknown",
            exported_at: e.createdAt,
            actor_id: e.actorId,
            request_id: e.requestId,
          })),
        },
        ctx,
      );
    }),

  /**
   * G5 / SR-5: rendered export artifacts. Returns the rendered document
   * (standalone print-optimized HTML, or Word-compatible .doc) and records
   * the export in the WORM-consistent audit chain exactly like exportMeta.
   * The .doc format is Word-compatible HTML — no DOCX library is available
   * in node_modules and heavy dependencies are intentionally not added.
   */
  exportRendered: authedQuery
    .input(
      z.object({
        brief_id: z.string().min(1),
        format: z.enum(["html", "doc"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, ["policy_analyst", "executive"]);
      const brief = await findBrief(input.brief_id);
      if (!brief)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "BRIEF_NOT_FOUND",
          message: `Brief ${input.brief_id} not found`,
        });
      await assertJurisdictionRead(ctx, brief.jurisdictionId);
      const meta = requestMeta(ctx);
      const { renderBrief } = await import("./utils/render");
      const artifact = renderBrief(brief as never, input.format, {
        requestId: meta.request_id,
      });
      await insertAuditEvent({
        actorId: ctx.user.id,
        action: "briefs.exported",
        entityType: "brief",
        entityId: input.brief_id,
        scopes: ["briefs:export"],
        requestId: meta.request_id,
        correlationId: meta.correlation_id,
        payload: {
          topic: "audit.events",
          data: {
            format: input.format,
            rendered: true,
            filename: artifact.filename,
            bytes: artifact.content.length,
            review_state: brief.reviewState,
            request_id: meta.request_id,
          },
        },
      });
      audit(ctx, "briefs.exported.rendered", {
        type: "brief",
        id: input.brief_id,
        scopes: ["briefs:export"],
        payload: { format: input.format, filename: artifact.filename },
      });
      return envelope(
        {
          brief_id: input.brief_id,
          format: artifact.format,
          filename: artifact.filename,
          mime_type: artifact.mimeType,
          content: artifact.content,
          request_id: meta.request_id,
        },
        ctx,
      );
    }),
});
