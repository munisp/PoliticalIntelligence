import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import type { TrpcContext } from "../context";
import {
  INDEX_DEFINITIONS,
  SEARCH_INDICES,
  ensureIndices,
  OpenSearchClient,
  __resetClientForTests,
  type BulkOperation,
} from "../search/opensearch";
import {
  createIndexerHandler,
  documentToOp,
} from "../consumers/opensearch-indexer";
import { createConsumer, type DomainEvent } from "../utils/events";

const ANON: TrpcContext = {
  req: new Request("http://test.local/"),
  resHeaders: new Headers(),
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENSEARCH_URL;
  __resetClientForTests();
});

/* --------------------------- mapping validity --------------------------- */

describe("opensearch index definitions", () => {
  const ALLOWED = new Set([
    "text",
    "keyword",
    "integer",
    "double",
    "date",
    "object",
    "geo_point",
    "boolean",
    "long",
  ]);

  it("defines the four search indices", () => {
    expect(SEARCH_INDICES.sort()).toEqual(
      ["pt-documents", "pt-laws", "pt-opportunities", "pt-stakeholders"].sort(),
    );
  });

  it("every property uses a valid OpenSearch field type", () => {
    const validate = (props: Record<string, any>, path: string) => {
      for (const [name, def] of Object.entries(props)) {
        expect(
          ALLOWED.has(def.type),
          `${path}.${name} has unknown type ${def.type}`,
        ).toBe(true);
        if (def.fields) validate(def.fields, `${path}.${name}.fields`);
      }
    };
    for (const [index, def] of Object.entries(INDEX_DEFINITIONS)) {
      const props = (def.mappings as any).properties;
      expect(props, `${index} has properties`).toBeTruthy();
      validate(props, index);
    }
  });

  it("each index has a keyword entity id and a date field", () => {
    const ids: Record<string, string> = {
      "pt-documents": "document_id",
      "pt-laws": "law_id",
      "pt-opportunities": "opportunity_id",
      "pt-stakeholders": "stakeholder_id",
    };
    for (const [index, idField] of Object.entries(ids)) {
      const props = (INDEX_DEFINITIONS[index]!.mappings as any).properties;
      expect(props[idField].type).toBe("keyword");
      expect(props.created_at.type).toBe("date");
    }
  });

  it("ensureIndices only creates missing indices (idempotent)", async () => {
    const existing = new Set(["pt-laws"]);
    const created: string[] = [];
    const fetchImpl = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (init?.method === "HEAD" || (!init?.method && !init?.body)) {
        const name = u.split("/").pop()!;
        return new Response(null, { status: existing.has(name) ? 200 : 404 });
      }
      if (init?.method === "PUT") {
        created.push(u.split("/").pop()!);
        return new Response(JSON.stringify({ acknowledged: true }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const client = new OpenSearchClient({ url: "http://os:9200", fetchImpl });
    const made = await ensureIndices(client);
    expect(made).not.toContain("pt-laws");
    expect(made.sort()).toEqual(
      ["pt-documents", "pt-opportunities", "pt-stakeholders"].sort(),
    );
    // Second pass: everything exists → nothing created.
    for (const n of created) existing.add(n);
    const again = await ensureIndices(client);
    expect(again).toEqual([]);
  });
});

/* --------------------------- fallback honesty --------------------------- */

describe("search router: search_engine honesty", () => {
  it("uses OpenSearch when configured and hits exist", async () => {
    process.env.OPENSEARCH_URL = "http://os:9200";
    __resetClientForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any) => {
        const u = String(url);
        if (u.includes("/_search")) {
          return new Response(
            JSON.stringify({
              hits: {
                hits: [
                  {
                    _index: "pt-laws",
                    _id: "law:test-1",
                    _score: 2.5,
                    _source: { title: "Procurement Law", jurisdiction_id: "jur:ng" },
                  },
                ],
              },
            }),
            { status: 200 },
          );
        }
        throw new Error(`unexpected fetch ${u}`);
      }),
    );
    const caller = appRouter.createCaller(ANON);
    const res = await caller.search.query({ q: "procurement", limit: 5 });
    expect((res.meta as any).search_engine).toBe("opensearch");
    const data = res.data as any;
    expect(data.adapter).toBe("opensearch");
    expect(data.results[0].id).toBe("law:test-1");
    expect(data.results[0].kind).toBe("law");
  });

  it("falls back to SQL and marks search_engine=sql when OpenSearch errors", async () => {
    process.env.OPENSEARCH_URL = "http://os:9200";
    __resetClientForTests();
    // Every fetch fails: OpenSearch down AND AI-service bridge down → SQL.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );
    const caller = appRouter.createCaller(ANON);
    const res = await caller.search.query({ q: "zz-no-match-zz", limit: 5 });
    expect((res.meta as any).search_engine).toBe("sql");
    expect((res.meta as any).retrieval_mode).toBe("fallback");
    expect((res.data as any).adapter).toBe("sql-like-fallback");
  });

  it("falls back (past OpenSearch empty hits) to SQL honestly", async () => {
    process.env.OPENSEARCH_URL = "http://os:9200";
    __resetClientForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any) => {
        const u = String(url);
        if (u.includes("/_search")) {
          return new Response(JSON.stringify({ hits: { hits: [] } }), { status: 200 });
        }
        // AI bridge unreachable.
        throw new Error("connection refused");
      }),
    );
    const caller = appRouter.createCaller(ANON);
    const res = await caller.search.query({ q: "empty", limit: 5 });
    expect((res.meta as any).search_engine).toBe("sql");
  });
});

/* -------------------------- indexer idempotency ------------------------- */

class MockOsClient {
  ops: BulkOperation[] = [];
  failNext = 0;
  async indexExists() {
    return true;
  }
  async createIndex() {}
  async bulk(ops: BulkOperation[]) {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error("bulk boom");
    }
    this.ops.push(...ops);
    return { indexed: ops.length, errors: 0 };
  }
}

const TEST_DOC_ID = "doc:os-indexer-test-1";

beforeAll(async () => {
  const db = getDb();
  const have = await db.query.policyDocuments.findFirst({
    where: eq(schema.policyDocuments.documentId, TEST_DOC_ID),
  });
  if (!have) {
    await db.insert(schema.policyDocuments).values({
      documentId: TEST_DOC_ID,
      title: "OpenSearch indexer fixture",
      jurisdictionId: "jur:ng",
      docType: "policy",
      origin: "seed",
    });
  }
});

describe("opensearch indexer consumer", () => {
  const event = (): DomainEvent => ({
    event_id: `evt_${Math.random().toString(36).slice(2)}`,
    topic: "documents.parse.requested",
    payload: { document_id: TEST_DOC_ID },
    occurred_at: new Date().toISOString(),
  });

  it("mapper produces doc id = entity id", async () => {
    const db = getDb();
    const row = (await db
      .select()
      .from(schema.policyDocuments)
      .where(eq(schema.policyDocuments.documentId, TEST_DOC_ID))
      .limit(1))[0]!;
    const op = documentToOp(row);
    expect(op.index).toBe("pt-documents");
    expect(op.id).toBe(TEST_DOC_ID);
    expect(op.doc.title).toBe("OpenSearch indexer fixture");
  });

  it("handler is idempotent: duplicate events converge to the same doc id", async () => {
    const mock = new MockOsClient();
    const handler = createIndexerHandler({ client: mock as never });
    const e = event();
    await handler(e);
    await handler(e); // duplicate delivery (at-least-once)
    const docOps = mock.ops.filter((o) => o.index === "pt-documents");
    expect(docOps.length).toBe(2);
    expect(new Set(docOps.map((o) => o.id)).size).toBe(1);
    expect(docOps[0]!.id).toBe(TEST_DOC_ID);
    // Same document body both times → upsert converges.
    expect(docOps[0]!.doc).toEqual(docOps[1]!.doc);
  });

  it("bulk failures dead-letter via the consumer framework", async () => {
    const mock = new MockOsClient();
    mock.failNext = 5; // exhaust retries
    const handler = createIndexerHandler({ client: mock as never });
    const consumer = createConsumer(
      "documents.parse.requested",
      handler,
      { group: "test-os-indexer-dlq", maxRetries: 2, backoffMs: 1 },
    );
    const outcome = await consumer.process(event());
    expect(outcome).toBe("dlq");
    const db = getDb();
    const dlqRows = await db
      .select()
      .from(schema.eventDlq)
      .where(eq(schema.eventDlq.consumerGroup, "test-os-indexer-dlq"));
    expect(dlqRows.length).toBeGreaterThan(0);
  });

  it("unknown topics index nothing", async () => {
    const mock = new MockOsClient();
    const handler = createIndexerHandler({ client: mock as never });
    await handler({ ...event(), topic: "ops.alerts" });
    expect(mock.ops.length).toBe(0);
  });
});
