import { createHash } from "node:crypto";
import {
  embedCardInput,
  embedCardOutput,
  embedScriptInput,
  embedScriptOutput,
} from "@contracts/embed";
import { createRouter, publicQuery } from "./middleware";
import { envelope, apiError } from "./utils/envelope";
import { evidenceByIds, findOpportunity } from "./queries/opportunities";
import type { TrpcContext } from "./context";

/**
 * I2 — Opportunity embed widgets (docs/EMBED.md).
 *
 * Public, rate-limited, sanitized card payloads + iframe-safe script tags.
 * Sanitization contract: title, sector, jurisdiction, summary, evidence
 * count and a canonical link ONLY — internal fields (score internals,
 * reviewState, createdBy, provenance, evidence payloads) never leave the
 * platform through this surface.
 */

/* ------------------------- naive fixed-window limiter ------------------------- */
/* Per-instance, per-client fixed window: 60 req/min. Keyed on a hash of    */
/* x-forwarded-for / x-real-ip (never logged raw). Good enough for a public */
/* read surface behind an ingress; swap for Redis at multi-replica scale.   */

const WINDOW_MS = 60_000;
const LIMIT = 60;
const buckets = new Map<string, { windowStart: number; count: number }>();

function clientKey(ctx: TrpcContext): string {
  const fwd = ctx.req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim() || ctx.req.headers.get("x-real-ip") || "anon";
  return createHash("sha256").update(ip).digest("hex").slice(0, 24);
}

export function rateLimitEmbed(ctx: TrpcContext): void {
  const key = clientKey(ctx);
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now - b.windowStart > WINDOW_MS) {
    buckets.set(key, { windowStart: now, count: 1 });
    return;
  }
  b.count += 1;
  if (b.count > LIMIT) {
    throw apiError(ctx, {
      http: "BAD_REQUEST",
      code: "EMBED_RATE_LIMITED",
      message: "Embed rate limit exceeded (60 req/min)",
      retryable: true,
    });
  }
}

/** Test hook: reset the limiter window. */
export function __resetEmbedRateLimit(): void {
  buckets.clear();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function originOf(ctx: TrpcContext): string {
  const proto = ctx.req.headers.get("x-forwarded-proto") ?? "https";
  const host =
    ctx.req.headers.get("x-forwarded-host") ?? ctx.req.headers.get("host") ?? "localhost";
  return `${proto}://${host}`;
}

async function buildCard(ctx: TrpcContext, opportunityId: string) {
  const opp = await findOpportunity(opportunityId);
  if (!opp) {
    throw apiError(ctx, {
      http: "NOT_FOUND",
      code: "OPPORTUNITY_NOT_FOUND",
      message: `Opportunity ${opportunityId} not found`,
      retryable: false,
    });
  }
  const refs = (opp.evidenceRefs as string[] | null) ?? [];
  const evidence = refs.length > 0 ? await evidenceByIds(refs) : [];
  return embedCardOutput.parse({
    opportunity_id: opp.opportunityId,
    title: opp.title,
    sector: opp.sectorCode,
    jurisdiction: opp.jurisdictionId,
    summary: opp.summary ?? null,
    evidence_count: evidence.length || refs.length,
    link: `${originOf(ctx)}/opportunities?id=${encodeURIComponent(opp.opportunityId)}`,
  });
}

export const embedRouter = createRouter({
  /** Public sanitized card payload (rate-limited). */
  opportunityCard: publicQuery
    .input(embedCardInput)
    .query(async ({ ctx, input }) => {
      rateLimitEmbed(ctx);
      const card = await buildCard(ctx, input.opportunity_id);
      return envelope(card, ctx);
    }),

  /**
   * iframe-safe HTML snippet: a static card with inline styles (no scripts)
   * that site owners paste directly, plus an optional <iframe> variant.
   * All dynamic text is HTML-escaped.
   */
  scriptTag: publicQuery
    .input(embedScriptInput)
    .query(async ({ ctx, input }) => {
      rateLimitEmbed(ctx);
      const card = await buildCard(ctx, input.opportunity_id);
      const bg = input.theme === "dark" ? "#101A2E" : "#FFFFFF";
      const fg = input.theme === "dark" ? "#E6ECF5" : "#1E2C47";
      const sub = input.theme === "dark" ? "#9AA8BF" : "#5E6D87";
      const html = [
        `<div class="meridian-opp-card" data-opportunity="${escapeHtml(card.opportunity_id)}" style="max-width:360px;border:1px solid #1E2C47;border-radius:8px;padding:16px;background:${bg};color:${fg};font-family:system-ui,sans-serif">`,
        `  <h3 style="margin:0 0 8px;font-size:16px">${escapeHtml(card.title)}</h3>`,
        `  <p style="margin:0 0 8px;font-size:13px;color:${sub}">${escapeHtml(card.summary ?? "")}</p>`,
        `  <p style="margin:0;font-size:12px;color:${sub}">${escapeHtml(card.sector)} · ${escapeHtml(card.jurisdiction)} · ${card.evidence_count} evidence sources</p>`,
        `  <a href="${escapeHtml(card.link)}" style="display:inline-block;margin-top:8px;font-size:13px;color:#3FAE9E" rel="noopener" target="_blank">View on Meridian Policy Twin</a>`,
        `</div>`,
      ].join("\n");
      return envelope(
        embedScriptOutput.parse({ opportunity_id: card.opportunity_id, html }),
        ctx,
      );
    }),
});
