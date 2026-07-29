import { z } from "zod";
import { nanoid } from "nanoid";
import {
  CommentInputSchema,
  ModerateInputSchema,
  aggregateThemes,
  tagThemes,
} from "@contracts/participation";
import { createRouter, publicQuery, authedQuery } from "./middleware";
import { envelope, apiError, audit } from "./utils/envelope";
import { requireRole } from "./utils/rbac";
import { redactText, logRedactionEvent } from "./utils/pii";
import {
  commentsForLaw,
  findComment,
  insertComment,
  setCommentStatus,
} from "./queries/participation";
import { findLaw } from "./queries/legislation";

/**
 * I6 — Public participation: citizens comment on bills; deterministic theme
 * aggregation summarises what the public is saying (keyword buckets, no ML).
 *
 * SEC: comment bodies + pseudonyms are PII-redacted before persistence
 * (AI-11), posting is rate-limited per actor/IP, and moderation is gated to
 * platform_admin / data_steward.
 */

/* Simple deterministic in-memory rate limiter (per process). */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimitKey(ctx: {
  user?: { id: number } | null;
  req: Request;
}): string {
  if (ctx.user) return `u:${ctx.user.id}`;
  const fwd = ctx.req.headers.get("x-forwarded-for");
  return `ip:${fwd?.split(",")[0]?.trim() ?? "anon"}`;
}

export function assertRateAllowed(key: string): void {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  b.count += 1;
  if (b.count > MAX_PER_WINDOW) {
    throw Object.assign(new Error("Rate limit exceeded — try again later"), {
      code: "RATE_LIMITED",
    });
  }
}

export const participationRouter = createRouter({
  /** Post a comment on a law (anonymous allowed with a pseudonym). */
  comment: publicQuery
    .input(CommentInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        assertRateAllowed(rateLimitKey(ctx));
      } catch {
        throw apiError(ctx, {
          http: "CONFLICT",
          code: "RATE_LIMITED",
          message: "Comment rate limit exceeded — try again later",
          retryable: true,
        });
      }
      const law = await findLaw(input.law_id);
      if (!law)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "LAW_NOT_FOUND",
          message: `Law ${input.law_id} not found`,
        });
      // PII redaction on free text before persistence (AI-11).
      const body = redactText(input.body);
      const pseudonym = input.pseudonym ? redactText(input.pseudonym) : null;
      const total = body.total + (pseudonym?.total ?? 0);
      if (total > 0) {
        logRedactionEvent("participation.comment", {
          ...(pseudonym?.counts ?? {}),
          ...body.counts,
        });
      }
      const commentId = `cmt:${nanoid(12)}`;
      const themes = tagThemes(body.text);
      const row = await insertComment({
        commentId,
        lawId: input.law_id,
        userId: ctx.user?.id ?? null,
        pseudonym: ctx.user ? (ctx.user.name ?? null) : (pseudonym?.text ?? null),
        body: body.text,
        sentimentHint: input.sentiment_hint,
        themeTags: themes,
      });
      audit(ctx, "participation.comment.posted", {
        type: "bill_comment",
        id: commentId,
        scopes: ["participation:write"],
        payload: { law_id: input.law_id, themes, redactions: total },
      });
      return envelope(row, ctx);
    }),

  /** Public list of non-hidden comments for a law. */
  list: publicQuery
    .input(
      z.object({
        law_id: z.string().min(1),
        limit: z.number().int().min(1).max(200).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await commentsForLaw(input.law_id, { limit: input.limit });
      return envelope(
        rows.map((r) => ({
          comment_id: r.commentId,
          law_id: r.lawId,
          pseudonym: r.pseudonym ?? (r.userId ? "Registered user" : "Anonymous"),
          body: r.body,
          sentiment_hint: r.sentimentHint,
          theme_tags: (r.themeTags as string[] | null) ?? [],
          status: r.status,
          created_at: r.createdAt,
        })),
        ctx,
      );
    }),

  /** Deterministic theme aggregation: counts per theme + sentiment split. */
  themes: publicQuery
    .input(z.object({ law_id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const rows = await commentsForLaw(input.law_id, { limit: 500 });
      const visible = rows.filter((r) => r.status === "visible");
      const themes = aggregateThemes(
        visible.map((r) => ({
          body: r.body,
          themeTags: r.themeTags,
          sentimentHint: r.sentimentHint,
        })),
      );
      return envelope(
        { law_id: input.law_id, total_comments: visible.length, themes },
        ctx,
      );
    }),

  /** Moderation: flag / hide / restore (platform_admin, data_steward). */
  moderate: authedQuery
    .input(ModerateInputSchema)
    .mutation(async ({ ctx, input }) => {
      requireRole(ctx, ["data_steward"]);
      const existing = await findComment(input.comment_id);
      if (!existing)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "COMMENT_NOT_FOUND",
          message: `Comment ${input.comment_id} not found`,
        });
      const updated = await setCommentStatus(input.comment_id, input.status);
      if (!updated)
        throw apiError(ctx, {
          http: "INTERNAL_SERVER_ERROR",
          code: "COMMENT_UPDATE_FAILED",
          message: "Comment status update failed",
          retryable: true,
        });
      audit(ctx, "participation.comment.moderated", {
        type: "bill_comment",
        id: input.comment_id,
        scopes: ["participation:moderate"],
        payload: {
          from_status: existing.status,
          to_status: input.status,
          reason: input.reason ?? null,
        },
      });
      return envelope(updated, ctx);
    }),
});
