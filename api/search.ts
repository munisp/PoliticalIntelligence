import { z } from "zod";
import { createRouter, publicQuery } from "./middleware";
import { envelope, apiError } from "./utils/envelope";
import { searchLike } from "./queries/admin";
import { findEvidence } from "./queries/opportunities";
import { copilotQuery, retrieveBundle } from "./bridges/ai";
import { evidenceByIds } from "./queries/opportunities";
import { getClient, SEARCH_INDICES } from "./search/opensearch";

export const searchRouter = createRouter({
  /**
   * Fused search across opportunities / laws / clauses / briefs with
   * provenance (AI-4). PRIMARY path: the AI service hybrid retriever
   * (SQL + vector + graph, RRF fusion) via POST /v1/retrieve, with the
   * EvidenceBundle mapped into the fused result shape. FALLBACK path: the
   * in-process SQL LIKE search when the AI service is unreachable. The
   * response meta marks `retrieval_mode: "hybrid" | "fallback"`.
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
      // --- OpenSearch path (docs/OPENSEARCH.md) --------------------------
      // When a cluster is configured, try the multi-index bool query first.
      // Fall through to hybrid retrieval / SQL LIKE when OpenSearch is
      // unavailable, errors, or returns zero hits. meta.search_engine is
      // the honesty marker: "opensearch" | "hybrid" | "sql".
      const os = getClient();
      if (os) {
        try {
          const hits = await os.search({
            indices: SEARCH_INDICES,
            query: input.q,
            filters: input.jurisdiction_id
              ? { jurisdiction_id: input.jurisdiction_id }
              : {},
            limit: input.limit,
          });
          if (hits.length > 0) {
            const KIND_BY_INDEX = {
              "pt-documents": "brief",
              "pt-laws": "law",
              "pt-opportunities": "opportunity",
              "pt-stakeholders": "brief",
            } as const;
            const results = hits.map((h) => ({
              kind: KIND_BY_INDEX[h.index as keyof typeof KIND_BY_INDEX] ?? ("brief" as const),
              id: h.id,
              title:
                (h.source.title as string | undefined) ??
                (h.source.name as string | undefined) ??
                h.id,
              snippet:
                ((h.source.summary as string | undefined) ??
                  (h.source.bio as string | undefined) ??
                  ""
                ).slice(0, 200) || null,
              score: h.score,
              provenance: {
                index: h.index,
                jurisdiction_id:
                  (h.source.jurisdiction_id as string | undefined) ??
                  input.jurisdiction_id ??
                  null,
              },
            }));
            const env = envelope(
              {
                q: input.q,
                results,
                adapter: "opensearch",
                retrieval_mode: "hybrid" as const,
              },
              ctx,
            );
            return {
              ...env,
              meta: {
                ...env.meta,
                retrieval_mode: "hybrid" as const,
                search_engine: "opensearch" as const,
              },
            };
          }
        } catch {
          // OpenSearch down/erroring → hybrid retrieval / SQL below.
        }
      }

      // --- hybrid retrieval path (AI service) ---------------------------
      try {
        const bundle = await retrieveBundle({
          query: input.q,
          jurisdiction_id: input.jurisdiction_id,
          top_k: input.limit,
        });
        // Map retrieval source types onto the legacy fused-result kind
        // union (front-end citation panel contract); the true type is
        // preserved in `source_type`.
        const KIND_BY_SOURCE_TYPE = {
          legal: "law",
          policy: "brief",
          metric: "opportunity",
          profile: "brief",
        } as const;
        const results = bundle.evidence
          .map((e) => ({
            kind: KIND_BY_SOURCE_TYPE[e.source_type] ?? ("brief" as const),
            source_type: e.source_type,
            id: e.evidence_source_id,
            title:
              (e.attributes?.title as string | undefined) ?? e.citation,
            snippet: e.content.slice(0, 200),
            score: e.confidence,
            provenance: {
              retrieval_path: e.retrieval_path,
              citation: e.citation,
              jurisdiction_id:
                (e.attributes?.jurisdiction as string | undefined) ??
                bundle.jurisdiction_id,
            },
          }))
          .slice(0, input.limit);
        const env = envelope(
          {
            q: input.q,
            results,
            adapter: "hybrid-retrieval",
            adapter_modes: bundle.adapter_modes,
            retrieval_paths_used: bundle.retrieval_paths_used,
            retrieval_mode: "hybrid" as const,
          },
          ctx,
        );
        return {
          ...env,
          meta: {
            ...env.meta,
            retrieval_mode: "hybrid" as const,
            search_engine: "hybrid" as const,
          },
        };
      } catch {
        // AI service unreachable/misconfigured → SQL LIKE fallback below.
      }

      // --- SQL LIKE fallback ---------------------------------------------
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
      const env = envelope(
        {
          q: input.q,
          results,
          adapter: "sql-like-fallback",
          retrieval_mode: "fallback" as const,
        },
        ctx,
      );
      return {
        ...env,
        meta: {
          ...env.meta,
          retrieval_mode: "fallback" as const,
          search_engine: "sql" as const,
        },
      };
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
