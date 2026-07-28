import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "../router";
import type { TrpcContext } from "../context";

/**
 * AI-4: gateway search delegates to the AI service hybrid retriever
 * (POST /v1/retrieve) when reachable and falls back to the SQL LIKE path
 * otherwise. Both modes are marked in the response meta.
 */

const ANON: TrpcContext = {
  req: new Request("http://test.local/"),
  resHeaders: new Headers(),
};

function hybridFetch(payload: unknown, capture: { url?: string; body?: any }) {
  return vi.fn(async (url: any, init?: any) => {
    capture.url = String(url);
    capture.body = init?.body ? JSON.parse(init.body) : undefined;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

const BUNDLE = {
  data: {
    bundle_id: "bnd:1",
    query: "procurement thresholds",
    jurisdiction_id: "jur:ng-kd",
    evidence: [
      {
        evidence_source_id: "clause:kd-pa-2007:s4",
        source_type: "legal",
        citation: "Kaduna Public Procurement Law 2007 §4",
        retrieval_path: "vector",
        confidence: 0.88,
        content: "Thresholds for open competitive bidding in Kaduna State.",
        attributes: { title: "Procurement thresholds", jurisdiction: "jur:ng-kd" },
      },
      {
        evidence_source_id: "metric:wb-gdp",
        source_type: "metric",
        citation: "World Bank — GDP (2024)",
        retrieval_path: "sql",
        confidence: 0.61,
        content: "GDP = 477399000000 USD [jur:ng, 2024] source: World Bank",
        attributes: {},
      },
    ],
    retrieval_paths_used: ["vector", "sql"],
    adapter_modes: { sql: "seeded-fallback", vector: "tfidf-fallback", graph: "in-process" },
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("search delegation (AI-4)", () => {
  it("delegates to /v1/retrieve and maps the EvidenceBundle (hybrid mode)", async () => {
    const capture: { url?: string; body?: any } = {};
    vi.stubGlobal("fetch", hybridFetch(BUNDLE, capture));
    const caller = appRouter.createCaller(ANON);
    const res = await caller.search.query({
      q: "procurement thresholds",
      jurisdiction_id: "jur:ng-kd",
      limit: 10,
    });
    // Delegation happened with the right payload.
    expect(capture.url).toContain("/v1/retrieve");
    expect(capture.body.query).toBe("procurement thresholds");
    expect(capture.body.jurisdiction_id).toBe("jur:ng-kd");
    // EvidenceBundle mapped into the fused result shape.
    expect(res.data.retrieval_mode).toBe("hybrid");
    expect((res.meta as any).retrieval_mode).toBe("hybrid");
    expect(res.data.adapter).toBe("hybrid-retrieval");
    expect(res.data.results).toHaveLength(2);
    const first = res.data.results[0] as any;
    expect(first.kind).toBe("law");
    expect(first.source_type).toBe("legal");
    expect(first.id).toBe("clause:kd-pa-2007:s4");
    expect(first.title).toBe("Procurement thresholds");
    expect(first.provenance.retrieval_path).toBe("vector");
    expect((res.data as any).adapter_modes.vector).toBe("tfidf-fallback");
  });

  it("falls back to SQL LIKE with retrieval_mode=fallback when AI is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    );
    const caller = appRouter.createCaller(ANON);
    const res = await caller.search.query({ q: "health", limit: 10 });
    expect(res.data.retrieval_mode).toBe("fallback");
    expect((res.meta as any).retrieval_mode).toBe("fallback");
    expect(res.data.adapter).toBe("sql-like-fallback");
    expect(Array.isArray(res.data.results)).toBe(true);
  });

  it("falls back when the AI service returns a malformed bundle", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ data: { nope: true } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const caller = appRouter.createCaller(ANON);
    const res = await caller.search.query({ q: "education", limit: 5 });
    expect(res.data.retrieval_mode).toBe("fallback");
  });
});
