import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { envelope, apiError } from "./utils/envelope";
import { searchLike } from "./queries/admin";
import { findEvidence } from "./queries/opportunities";
import { copilotQuery } from "./bridges/ai";
import { evidenceByIds } from "./queries/opportunities";

export const searchRouter = createRouter({
  /**
   * Fused search across opportunities / laws / clauses / briefs with
   * provenance. This is the SQL LIKE + naive-scoring fallback; the hybrid
   * retrieval service (vector + graph adapters) plugs in at
   * services/ai POST /v1/copilot/query — see api/bridges/ai.ts.
   */
  query: publicQuery
    .input(
      z.object({
        q: z.string().min(1).max(200),
        jurisdiction_id: z.string().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const raw = await searchLike({
        q: input.q,
        jurisdictionId: input.jurisdiction_id,
        limit: input.limit,
      });
      const results = [
        ...raw.opportunities.map((o) => ({
          kind: "opportunity" as const,
          id: o.opportunityId,
          title: o.title,
          snippet: o.summary?.slice(0, 200) ?? null,
          score: o.score,
          provenance: { table: "opportunities", jurisdiction_id: o.jurisdictionId },
        })),
        ...raw.laws.map((l) => ({
          kind: "law" as const,
          id: l.lawId,
          title: l.title,
          snippet: `${l.category ?? "legislation"} · ${l.year ?? "n.d."}`,
          score: 0.5,
          provenance: { table: "laws", jurisdiction_id: l.jurisdictionId },
        })),
        ...raw.clauses.map((c) => ({
          kind: "clause" as const,
          id: c.clauseId,
          title: `${c.lawId} § ${c.sectionPath}`,
          snippet: c.text.slice(0, 200),
          score: c.confidence,
          provenance: { table: "clauses", law_id: c.lawId },
        })),
        ...raw.briefs.map((b) => ({
          kind: "brief" as const,
          id: b.briefId,
          title: b.title,
          snippet: `${b.template} · ${b.reviewState}`,
          score: 0.5,
          provenance: { table: "briefs", jurisdiction_id: b.jurisdictionId },
        })),
      ]
        .sort((a, b) => b.score - a.score)
        .slice(0, input.limit);
      return envelope({ q: input.q, results, adapter: "sql-like-fallback" }, ctx);
    }),

  /** Copilot-style grounded Q&A (AI bridge with DB-evidence fallback). */
  ask: publicQuery
    .input(
      z.object({
        q: z.string().min(1).max(1000),
        jurisdiction_id: z.string().optional(),
        evidence_ids: z.array(z.string()).max(10).default([]),
      }),
    )
    .query(async ({ ctx, input }) => {
      const evidence = await evidenceByIds(input.evidence_ids);
      const answer = await copilotQuery({
        query: input.q,
        jurisdiction_id: input.jurisdiction_id,
        evidence: evidence.map((e) => ({
          evidence_source_id: e.evidenceSourceId,
          source_type: e.sourceType,
          citation: e.citation,
          confidence: e.confidence,
          excerpt: e.contentExcerpt,
        })),
      });
      return envelope(answer, ctx);
    }),

  evidence: publicQuery
    .input(z.object({ evidence_source_id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const ev = await findEvidence(input.evidence_source_id);
      if (!ev)
        throw apiError(ctx, {
          http: "NOT_FOUND",
          code: "EVIDENCE_NOT_FOUND",
          message: `Evidence source ${input.evidence_source_id} not found`,
        });
      return envelope(ev, ctx);
    }),
});
