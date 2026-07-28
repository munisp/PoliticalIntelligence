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

## Deployment modes (API-9, spec §14 service decomposition)

The Node API can run in two deployment modes, selected by `SERVICES_MODE`:

### Monolith (default — `SERVICES_MODE=monolith`)

A single `api-gateway` container serves the full in-process route table:
tRPC (`/api/trpc/*` over `appRouter`) and the canonical REST `/v1` facade
(`api/rest.ts`), plus the in-process workers (event consumers, outbox relay,
job heartbeats). This is the default in `infra/docker/docker-compose.yml` and
is fully runnable locally with no extra services.

### Micro (`SERVICES_MODE=micro`)

The gateway becomes a pure router: it forwards each `/v1/*` and
`/api/trpc/*` request to the owning **domain service** over HTTP
(`api/services/gateway.ts`), preserving method, headers and body. The
decomposition registry (`api/services/index.ts`) maps 8 independently
deployable domain services to ports and router sets — each boots from its own
entrypoint (`api/services/<domain>.ts`, `npm run dev:service:<domain>`) and
mounts ONLY its domain's tRPC sub-routers and REST routes; everything else
404s. There is no logic duplication: domain services import the same router
modules and REST handlers as the monolith.

| Domain service      | Port | tRPC routers                          | REST /v1 routes                          |
|---------------------|------|---------------------------------------|------------------------------------------|
| jurisdictions       | 3001 | jurisdictions, sectors, geo           | /jurisdictions*, /sectors                |
| opportunities       | 3002 | opportunities, innovations, search    | /opportunities*, /jobs/:id, /search      |
| scenarios           | 3003 | scenarios                             | /scenarios*, /scenario-runs/:id          |
| legislation         | 3004 | legislation                           | /legislation/*                           |
| documents-gateway   | 3005 | documents                             | (tRPC only — proxies documents service)  |
| briefs              | 3006 | briefs                                | /briefs*                                 |
| admin               | 3007 | auth, admin, auditLog, onboarding     | /auth/*                                  |
| ops                 | 3008 | ops                                   | /health                                  |

The remaining §14 spec services are already separate deployables or workers:
`simulation`, `ai`, `ingestion`, `documents` (Python services), plus the
in-process `consumers` (event consumers/DLQ replayer), the outbox relay
(event writer) and the ingestion scheduler (`ingestion-scheduler` compose
profile) — 19 deployable units in total.

Domain-service URLs are configured with `SERVICE_URL_<DOMAIN>`
(e.g. `SERVICE_URL_BRIEFS=http://briefs:3006`); defaults are
`http://localhost:30xx`. In compose, micro mode is env-gated and uses one
image with different CMDs:

```bash
SERVICES_MODE=micro docker compose -f infra/docker/docker-compose.yml \
  --profile microservices up --build
```

Route-table isolation and both gateway modes are covered by
`api/tests/service-decomposition.test.ts` (20 tests).
