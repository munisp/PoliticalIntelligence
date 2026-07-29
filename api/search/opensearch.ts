/**
 * OpenSearch index manager + minimal REST client (docs/OPENSEARCH.md).
 *
 * No client dependency: the client is a thin wrapper over the OpenSearch
 * REST API via fetch, so the API has zero new required deps and the client
 * is trivially mockable in tests. Guarded by OPENSEARCH_URL — when unset,
 * `getClient()` returns null and all search paths fall back to SQL.
 *
 * Indices (single-node dev: 1 shard, 0 replicas):
 *  - pt-documents     policy_documents (title/metadata text + keyword)
 *  - pt-laws          laws (title/category/status/year)
 *  - pt-opportunities opportunities (title/summary/sector/score)
 *  - pt-stakeholders  stakeholders (name/org/state/sector tags)
 */

export interface OsClientOptions {
  url: string;
  /** Inject for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export interface BulkOperation {
  index: string;
  id: string;
  doc: Record<string, unknown>;
}

export class OpenSearchClient {
  private base: string;
  private doFetch: typeof fetch;

  constructor(opts: OsClientOptions) {
    this.base = opts.url.replace(/\/+$/, "");
    this.doFetch = opts.fetchImpl ?? fetch;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: unknown }> {
    const resp = await this.doFetch(`${this.base}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(Number(process.env.OPENSEARCH_TIMEOUT_MS ?? 5_000)),
    });
    const text = await resp.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { status: resp.status, json };
  }

  async ping(): Promise<boolean> {
    try {
      const { status } = await this.request("GET", "/_cluster/health");
      return status === 200;
    } catch {
      return false;
    }
  }

  async indexExists(name: string): Promise<boolean> {
    try {
      const { status } = await this.request("HEAD", `/${name}`);
      return status === 200;
    } catch {
      return false;
    }
  }

  async createIndex(
    name: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    const { status, json } = await this.request("PUT", `/${name}`, body);
    if (status !== 200) {
      throw new Error(
        `createIndex ${name} failed: HTTP ${status} ${JSON.stringify(json)}`,
      );
    }
  }

  /** Idempotent bulk index (action=index, doc id = entity id). */
  async bulk(ops: BulkOperation[]): Promise<{ indexed: number; errors: number }> {
    if (ops.length === 0) return { indexed: 0, errors: 0 };
    const ndjson =
      ops
        .flatMap((op) => [
          JSON.stringify({ index: { _index: op.index, _id: op.id } }),
          JSON.stringify(op.doc),
        ])
        .join("\n") + "\n";
    const resp = await this.doFetch(`${this.base}/_bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/x-ndjson" },
      body: ndjson,
      signal: AbortSignal.timeout(Number(process.env.OPENSEARCH_TIMEOUT_MS ?? 30_000)),
    });
    const json = (await resp.json()) as {
      errors?: boolean;
      items?: { index?: { status?: number } }[];
    };
    if (!resp.ok) {
      throw new Error(`bulk failed: HTTP ${resp.status}`);
    }
    const items = json.items ?? [];
    const errors = items.filter((i) => (i.index?.status ?? 500) >= 300).length;
    return { indexed: items.length - errors, errors };
  }

  /** Multi-index bool query with optional keyword filters. */
  async search(params: {
    indices: string[];
    query: string;
    filters?: Record<string, string>;
    limit: number;
  }): Promise<OsHit[]> {
    const must: unknown[] = [
      {
        multi_match: {
          query: params.query,
          fields: ["title^3", "name^3", "summary", "text", "bio", "*"],
          type: "best_fields",
          lenient: true,
        },
      },
    ];
    const filter = Object.entries(params.filters ?? {})
      .filter(([, v]) => v)
      .map(([k, v]) => ({ term: { [k]: v } }));
    const { status, json } = await this.request(
      "POST",
      `/${params.indices.join(",")}/_search`,
      {
        size: params.limit,
        query: { bool: { must, filter } },
      },
    );
    if (status !== 200) {
      throw new Error(`search failed: HTTP ${status} ${JSON.stringify(json)}`);
    }
    const hits =
      (json as { hits?: { hits?: { _index: string; _id: string; _score: number; _source: Record<string, unknown> }[] } })
        .hits?.hits ?? [];
    return hits.map((h) => ({
      index: h._index,
      id: h._id,
      score: h._score,
      source: h._source,
    }));
  }
}

export interface OsHit {
  index: string;
  id: string;
  score: number;
  source: Record<string, unknown>;
}

/* ------------------------------ indices -------------------------------- */

const TEXT_KEYWORD = { type: "text", fields: { keyword: { type: "keyword" } } };

export const INDEX_DEFINITIONS: Record<
  string,
  { mappings: Record<string, unknown> }
> = {
  "pt-documents": {
    mappings: {
      properties: {
        document_id: { type: "keyword" },
        title: TEXT_KEYWORD,
        jurisdiction_id: { type: "keyword" },
        language: { type: "keyword" },
        doc_type: { type: "keyword" },
        review_state: { type: "keyword" },
        source_uri: { type: "keyword" },
        metadata: { type: "object", enabled: true },
        origin: { type: "keyword" },
        created_at: { type: "date" },
      },
    },
  },
  "pt-laws": {
    mappings: {
      properties: {
        law_id: { type: "keyword" },
        title: TEXT_KEYWORD,
        jurisdiction_id: { type: "keyword" },
        category: TEXT_KEYWORD,
        status: { type: "keyword" },
        year: { type: "integer" },
        source_uri: { type: "keyword" },
        created_at: { type: "date" },
      },
    },
  },
  "pt-opportunities": {
    mappings: {
      properties: {
        opportunity_id: { type: "keyword" },
        title: TEXT_KEYWORD,
        summary: { type: "text" },
        jurisdiction_id: { type: "keyword" },
        sector_code: { type: "keyword" },
        score: { type: "double" },
        review_state: { type: "keyword" },
        horizon_months: { type: "integer" },
        origin: { type: "keyword" },
        created_at: { type: "date" },
      },
    },
  },
  "pt-stakeholders": {
    mappings: {
      properties: {
        stakeholder_id: { type: "keyword" },
        kind: { type: "keyword" },
        name: TEXT_KEYWORD,
        title: { type: "text" },
        org: TEXT_KEYWORD,
        state: { type: "keyword" },
        chamber: { type: "keyword" },
        sector_tags: { type: "keyword" },
        bio: { type: "text" },
        influence_area: { type: "text" },
        origin: { type: "keyword" },
        created_at: { type: "date" },
      },
    },
  },
};

export const SEARCH_INDICES = Object.keys(INDEX_DEFINITIONS);

/** Create any missing indices with their mappings (idempotent). */
export async function ensureIndices(client: OpenSearchClient): Promise<string[]> {
  const created: string[] = [];
  for (const [name, def] of Object.entries(INDEX_DEFINITIONS)) {
    if (await client.indexExists(name)) continue;
    await client.createIndex(name, {
      settings: { number_of_shards: 1, number_of_replicas: 0 },
      ...def,
    });
    created.push(name);
  }
  return created;
}

/* --------------------------- client singleton --------------------------- */

let clientSingleton: OpenSearchClient | null = null;

/** Shared client, or null when OPENSEARCH_URL is unset. */
export function getClient(): OpenSearchClient | null {
  if (!process.env.OPENSEARCH_URL) return null;
  clientSingleton ??= new OpenSearchClient({ url: process.env.OPENSEARCH_URL });
  return clientSingleton;
}

/** Test hook: drop the singleton. */
export function __resetClientForTests(): void {
  clientSingleton = null;
}
