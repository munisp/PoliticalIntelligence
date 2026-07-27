# Architecture

**Jurisdiction Economic Intelligence & Policy Twin Platform** — an evidence-grounded, sovereign-ready, open-source policy intelligence and economic digital twin platform for governors, ministries, and public-sector analysts.

## One-page summary

The platform continuously ingests official statistics, legislation, budgets, procurement records, and geospatial data for a jurisdiction; normalizes them into a canonical data model across operational, analytical, graph, search, and geospatial stores; and exposes that knowledge through domain APIs and six product surfaces. On top of the data backbone sit an AI layer (Qwen3-first LLM family with a DeepSeek-R1 specialist tier, served via vLLM and orchestrated by Ray Serve) and a simulation layer (scenario and policy-twin engines) that let decision-makers ask *what is happening*, *why*, and *what happens if we do X* — always with citations back to evidence.

Nigeria is the reference deployment (federal/state/LGA/ward), with pilot sectors: education, SME formation, and procurement-led job creation. See `NIGERIA_PILOT.md`.

## Layered reference architecture

```
┌────────────────────────────────────────────────────────────────────┐
│ APIs & Apps                                                        │
│  React+Vite+TS PWA (6 product screens + copilot) · Capacitor mobile│
│  Hono+tRPC REST/RPC API (/v1) · Python service APIs (8100/8200)    │
├────────────────────────────────────────────────────────────────────┤
│ AI & Simulation                                                    │
│  services/ai — model router (Qwen3 tiers, DeepSeek-R1 specialist), │
│   hybrid retrieval (vector + graph + SQL), RAG, brief generation   │
│  services/simulation — scenario engine, economic twin, calibration │
│  Serving: vLLM · Orchestration: Ray Serve                          │
├────────────────────────────────────────────────────────────────────┤
│ Data & Knowledge                                                   │
│  MySQL (Drizzle, operational) · Apache Iceberg lakehouse + Trino   │
│  Neo4j knowledge graph · OpenSearch (text+vector) · PostGIS (geo)  │
│  MinIO/S3 object storage · dbt data contracts · lineage            │
├────────────────────────────────────────────────────────────────────┤
│ Ingestion                                                          │
│  Source connectors (stats portals, gazettes, budgets, procurement, │
│  geo) · document parsing pipeline · Redpanda event backbone        │
├────────────────────────────────────────────────────────────────────┤
│ Platform ops (cross-cutting)                                       │
│  Keycloak OIDC + RBAC · immutable audit (7y) · OpenTelemetry,      │
│  Prometheus/Grafana · Vault secrets · CI/CD, GitOps (Argo CD)      │
└────────────────────────────────────────────────────────────────────┘
```

## Plain-English data flow

1. **Collect.** Connectors pull (or receive pushes of) official data and documents from registered sources. Every raw artifact lands in object storage and an `ingest.raw.received` event is emitted.
2. **Parse & normalize.** The document pipeline extracts text, tables, and metadata; records are validated against data contracts and mapped to the canonical model (see `DATA_MODEL.md`).
3. **Index.** Curated records fan out: relational facts to MySQL, history to the Iceberg lakehouse, relationships to Neo4j, text+embeddings to OpenSearch, geometries to PostGIS. `graph.index.updated` / `features.materialized` events mark readiness.
4. **Reason.** Analyst requests (opportunity generation, legislation comparison, what-if scenarios) are queued as jobs. The AI service retrieves evidence via hybrid vector+graph+SQL retrieval and routes generation to the right model tier; the simulation service runs scenario ensembles.
5. **Deliver.** Results return through the standard API envelope with citations, and every action is written to the immutable audit log.

## Key services

| Component            | Tech                                  | Role                                            |
| -------------------- | ------------------------------------- | ----------------------------------------------- |
| Root app             | React+Vite+TS PWA · Hono+tRPC · Drizzle | Product UI + domain API gateway               |
| `services/simulation`| Python FastAPI                        | Scenario engine, economic twin, calibration     |
| `services/ai`        | Python FastAPI                        | Model routing, hybrid retrieval, RAG, briefs    |
| MySQL 8              | Drizzle ORM                           | Operational store                               |
| Iceberg + Trino      | Lakehouse + query fabric              | Historical/analytical queries                   |
| Neo4j 5              | Knowledge graph                       | Entities, laws, relationships                   |
| OpenSearch 2         | Search + vectors                      | Full-text and semantic retrieval                |
| PostGIS 16           | Geospatial                            | Wards/LGAs/facilities/GRID3 layers              |
| Redpanda             | Kafka-compatible events               | Async jobs, ingest fan-out (see `EVENTS.md`)    |
| Keycloak 24          | OIDC                                  | Identity, RBAC roles                            |

## Operating modes

- **Dev** — single-node everything (`infra/docker`), synthetic data, Qwen3 small dev tier, in-process model stubs acceptable.
- **Staging** — production-like sizing, production-shaped data, Qwen3-32B tier, canary releases of the app.
- **Prod** — hardened and isolated: dedicated event brokers per workload domain, GPU pools per model tier (interactive / premium / specialist / batch), NetworkPolicies, Vault-managed secrets.

## Tenancy model

The platform is **jurisdiction-partitioned, single-tenant-per-deployment by default**. One sovereign deployment serves one country (e.g. Nigeria) and partitions all data by `jurisdiction_id` (federal → state → LGA → ward). Row-level and policy-level authorization (see `SECURITY.md`) scopes every query, retrieval, simulation, and audit record to jurisdictions the actor may access. A deployment may also be run fully on-premises/in-country for data sovereignty; there is no cross-tenant data sharing and no external model API dependency — all models are self-hosted.
