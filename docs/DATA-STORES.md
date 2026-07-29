# Data Stores — roles and boundaries

One sentence per store; the rule is **MySQL is canonical, everything else is
a derived/operational plane** that can be rebuilt from it.

| Store | Role | Notes |
|---|---|---|
| **MySQL 8** (Drizzle ORM) | Canonical OLTP | All domain entities (opportunities, laws, policy_documents, stakeholders, jobs, outbox). Drizzle migrations under `db/migrations`. Source of truth for every read model. |
| **Postgres 16 + PostGIS** | Geospatial + operational store for new services | Wards/LGAs/facilities/GRID3 layers (`POSTGIS_URL`). Also the designated DB for operational services that expect Postgres: **Temporal** (workflow DB) and **Permify** (authz). Compose service `postgis` runs `infra/docker/postgis/init/01-extensions.sql` on first boot (idempotent `CREATE EXTENSION IF NOT EXISTS postgis, postgis_topology`). |
| **Redis 7** | Cache + rate limiting | `REDIS_URL`. Read-through cache (`api/utils/cache.ts cached()`) and sliding-window rate limiter (`api/utils/ratelimit.ts`). Optional: both fall back to in-process implementations when unset. See docs/REDIS.md. |
| **OpenSearch 2** | Search plane | `OPENSEARCH_URL`. Indices `pt-documents`, `pt-laws`, `pt-opportunities`, `pt-stakeholders` (`api/search/opensearch.ts`). Fed by the outbox indexer consumer and `scripts/opensearch-reindex.ts`. Search falls back to SQL honestly (`meta.search_engine`). See docs/OPENSEARCH.md. |
| **Iceberg / MinIO** | Analytics lakehouse | S3-compatible object storage (`S3_*`) for documents, WORM audit exports, and lakehouse staging; Trino for ad-hoc analytics. |
| **Neo4j** | Knowledge graph | Entities, laws, relationships (`NEO4J_URI`). |
| **Redpanda (Kafka API)** | Event backbone | Durable topics for the event catalog (docs/EVENTS.md); the MySQL `event_outbox` is the fallback transport. |

## Rules of engagement

1. Writes go to MySQL first. Derived planes (OpenSearch, graph, cache) are
   updated asynchronously via the outbox/event consumers and are always
   rebuildable (`scripts/opensearch-reindex.ts`).
2. Nothing reads from a derived plane without a fallback to the canonical
   store, and the response must say which engine answered
   (`meta.search_engine`, `retrieval_mode`).
3. Geospatial queries that need `ST_*` functions go to Postgres/PostGIS;
   domain CRUD never does.
4. Cache keys must be derivable and expire; the cache is never a
   correctness dependency.
