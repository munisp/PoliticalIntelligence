# OpenSearch runbook — search plane

## Topology

Dev: single node, security plugin disabled (`plugins.security.disabled=true`,
`DISABLE_SECURITY_PLUGIN=true`), 512m heap. Compose service `opensearch`;
K8s dev manifest `infra/k8s/base/opensearch.yaml`. Production must enable
the security plugin + TLS (managed domain recommended).

## Indices

Defined in `api/search/opensearch.ts` (`INDEX_DEFINITIONS`), 1 shard /
0 replicas in dev:

- `pt-documents` — policy_documents (title text+keyword, jurisdiction, doc_type, metadata)
- `pt-laws` — laws (title text+keyword, category, status, year)
- `pt-opportunities` — opportunities (title/summary, sector_code, score)
- `pt-stakeholders` — stakeholders (name/org text+keyword, state, sector_tags)

Create/upgrade: `ensureIndices()` runs on indexer startup and in the
reindex script; it only creates missing indices (never mutates mappings —
reindex to change a mapping).

## Data flow

1. **Live:** the indexer consumer (`api/consumers/opensearch-indexer.ts`)
   subscribes to `documents.parse.requested` and `graph.index.updated`,
   re-reads the canonical MySQL rows, and bulk-indexes. Doc id = entity id,
   so duplicates/replays converge. Registered from `startConsumers()` only
   when `OPENSEARCH_URL` is set. Failures retry 3× then land in
   `event_dlq` (replay via `events.replay`, see docs/EVENTS.md).
2. **Backfill/rebuild:**
   ```bash
   OPENSEARCH_URL=http://localhost:9200 DATABASE_URL=mysql://... \
     npx tsx scripts/opensearch-reindex.ts            # all indices
   # or: ... --kind laws
   ```

## Query path + honesty

`search.query` (api/search.ts) tries OpenSearch first (multi-index bool
query, `jurisdiction_id` term filter), then the AI hybrid retriever, then
SQL LIKE. The response always says what answered:

- `meta.search_engine: "opensearch" | "hybrid" | "sql"`
- `retrieval_mode: "hybrid" | "fallback"` (unchanged legacy contract)

An OpenSearch outage or empty result silently degrades to the next engine;
there is no hard dependency on the cluster.

## Operate

- **Health:** `curl $OPENSEARCH_URL/_cluster/health`
- **Counts:** `curl $OPENSEARCH_URL/_cat/indices?v`
- **Spot check:** `curl "$OPENSEARCH_URL/pt-laws/_search?q=procurement"`
- **Full rebuild:** drop indices (`curl -XDELETE $OPENSEARCH_URL/pt-\*`)
  then run the reindex script — canonical data is in MySQL.

## Test

`npx vitest run api/tests/opensearch.test.ts` — mapping validity,
ensureIndices idempotency, fallback honesty, indexer idempotency + DLQ
(mocked client; no live cluster needed).
