# Compliance Audit — Jurisdiction Economic Intelligence & Policy Twin Platform

**Audit date:** 2025 (code-as-found). **Method:** direct code inspection of `api/`, `db/`, `contracts/`, `services/`, `src/`, `mobile/`, `infra/`, `.github/`, plus execution of the Python test suites (simulation: 32 passed; ai: 25 passed) and the Node suite (**broken — all 3 test files fail to load**, see TEST-1).

## Executive summary

**Overall: 29% FULLY implemented (26/90), 39% PARTIAL/scaffold (35/90), 32% NOT implemented (29/90) — 90 requirements assessed.**

| Category | FULL ✅ | PARTIAL 🟡 | NOT ❌ | Honest read |
| --- | --- | --- | --- | --- |
| System/business reqs (SR-1..10) | 4 | 5 | 1 | Core product loop works end-to-end on seeded data; ingestion absent |
| API & contracts (§15, §38–40) | 4 | 4 | 2 | Envelope/errors/pagination/§9.2 contract real; no REST `/v1` surface (tRPC only); only 3 of 19 spec services exist |
| Canonical data model (§16, §25) | 1 | 5 | 2 | Solid MySQL schema for pilot entities; missing budgets, procurement, facilities, wards, boundaries, Iceberg snapshots |
| Ingestion & document/legal pipeline (§17–18) | 1 | 1 | 6 | **No real external ingestion exists — 100% seeded demo data.** No OCR, no LexNLP, no Akoma Ntoso, no Airbyte/Dagster |
| Graph, retrieval, AI (§19–21, §37) | 1 | 5 | 6 | Hybrid retrieval + routing code is real and tested, but runs on in-process fallbacks; **no vLLM/Qwen3/Ray serving exists** (deterministic offline synthesizer by default) |
| Simulation & digital twin (§22–23) | 4 | 1 | 1 | Six engines implemented, deterministic, tested; models are simplified heuristics, twin is in-memory, no backtesting |
| Geospatial (§24) | 0 | 1 | 2 | PostGIS container runs but **no code ever connects to it**; no CesiumJS; SVG tile grid is the default map |
| Eventing (§26) | 0 | 1 | 1 | Redpanda container + topic constants only; **zero producer/consumer code** |
| Security & audit (§27) | 1 | 3 | 2 | RBAC genuinely enforced; **auth is Kimi OAuth, Keycloak is an unwired placeholder**; audit log is a plain MySQL table, not WORM/7-yr; no ABAC |
| Observability (§28) | 1 | 2 | 0 | Prometheus/Grafana/OTel configs real; **no service emits the metrics the alerts reference** |
| Environments & CI/CD (§29–30) | 1 | 3 | 2 | Compose stack is genuinely full; k8s/terraform are scaffolds; CI has no deploy, no contract/e2e/perf jobs; **Node tests are broken and not run in CI** |
| Testing & NFRs (§31) | 1 | 2 | 4 | Python suites pass (57 tests, verified); no k6, E2E, eval harness, DR drill, or localization test. Almost no NFR is verifiably met |
| UX (§7.3) & mobile | 7 | 2 | 0 | **Strongest area.** All 6 screens + copilot are deep, polished, and wired to the live API — over seeded data. Mobile shell unwired |
| **TOTAL (90)** | **26 (29%)** | **35 (39%)** | **29 (32%)** | |

**Bottom line:** This is a high-quality *product demo*: a genuinely end-to-end loop (UI → tRPC → MySQL → async jobs → Python services) over seeded Nigeria pilot data, with real simulation engines and real hybrid-retrieval/routing code that degrade gracefully to deterministic fallbacks. It is **not yet** the specified platform: there is no real data ingestion, no document/legal parsing pipeline, no live LLM serving, no event streaming, no geospatial store usage, and no identity-plane/audit/sovereignty controls. Roughly a third of the spec is docs-plus-containers only.

---

## Full requirement matrix

Legend: ✅ fully implemented (works end-to-end, cited) · 🟡 partial/scaffold · ❌ not implemented

### SR / BR system & business requirements

| # | Requirement | Status | Evidence path | Gap description | Recommended fix |
| --- | --- | --- | --- | --- | --- |
| SR-1 | Continuous ingestion of official statistics, legislation, budgets, procurement, geodata | ❌ | `db/seed.ts`; `api/queries/sources.ts` (registry only) | No connector/pull/scrape code exists anywhere; all data is hand-written seed. `pipeline_runs` rows are fabricated by the seed | Build connector framework emitting `ingest.raw.received`; implement ≥3 Nigeria sources (NBS, UBEC, CAC) per `NIGERIA_PILOT.md` |
| SR-2 | Canonical jurisdiction-partitioned model | 🟡 | `db/schema.ts` (`jurisdictions`, `adminUnits`, `sectorMetrics`) | Hierarchy exists (federal/state/LGA) but no ward level in seed, no `geometry_ref`, no population-source-year metadata on `jurisdictions` | Add wards + boundary refs; backfill metadata fields from DATA_MODEL.md |
| SR-3 | Evidence-grounded recommendations (citations) | ✅ | `contracts/entities.ts` (`Recommendation.evidence_base`), `api/runner.ts`, `services/ai/app/llm/offline.py` | Contract enforces ≥1 evidence ref; UI EvidenceDrawer surfaces citations | — |
| SR-4 | What-if simulation | ✅ | `services/simulation/app/engines/*.py`, `api/bridges/simulation.ts`, tests pass (32) | Engines are simplified parametric models, not calibrated to real data | Calibration/backtesting against historical outcomes |
| SR-5 | Executive briefs with citations rail | 🟡 | `api/briefs.ts`, `api/runner.ts` (`briefs.generate`) | Brief content is a **hard-coded template** ("This brief was generated from the current evidence base…"); `citations_rail: []` always empty; no PDF/HTML export | Generate from real retrieval bundle; populate citations rail; add export |
| SR-6 | Data source health console | ✅ | `api/admin.ts`, `api/ops.ts` (`freshnessSummary`), `src/pages/DataHealth.tsx` (10 tRPC calls) | Fully functional — over seeded freshness values; nothing real refreshes | Wire to real ingest telemetry |
| SR-7 | Copilot Q&A with evidence panel | ✅ | `src/pages/Copilot.tsx`, `api/bridges/ai.ts` (`copilotQuery`), `services/ai/app/main.py` `/v1/copilot/query` | Works end-to-end; answers are template-assembled offline synthesizer unless vLLM configured | Point `VLLM_BASE_URL` at a served Qwen3 tier |
| SR-8 | Legislation workbench | 🟡 | `api/legislation.ts`, `src/pages/Legislation.tsx` | Navigator/clause reader/citation trace/review states real; **`POST /v1/legislation/compare` does not exist** (no comparison/impact-note endpoint); clauses are seeded, not parsed | Implement compare endpoint + DeepSeek-R1 specialist analysis path |
| SR-9 | Async job architecture (202 + job handle + idempotency) | 🟡 | `api/utils/jobs.ts`, `api/runner.ts`, `db/schema.ts` (`jobs.idempotencyKey` unique) | Jobs run in a **singleton in-process runner** — lost on restart, no distribution, no DLQ, no event publication. Idempotency-key dedup is real | Move job dispatch to Redpanda consumers; persist retries/DLQ |
| SR-10 | Jurisdiction-partitioned tenancy / data sovereignty | 🟡 | `db/schema.ts` (`jurisdictionId` columns), `docs/ARCHITECTURE.md` | Data is partitioned by `jurisdiction_id`, but **no query is actually scoped to the actor's jurisdictions**; all list endpoints are `publicQuery` with no authz filter | Implement jurisdiction-scoped ABAC in every query + retrieval filter |

### API & contracts (§15, §38–40)

| # | Requirement | Status | Evidence | Gap | Fix |
| --- | --- | --- | --- | --- | --- |
| API-1 | Standard envelope `{data, meta, audit}` | ✅ | `api/utils/envelope.ts`, `services/*/app/main.py` `_envelope` | Implemented in gateway and both Python services | — |
| API-2 | Structured error envelopes | ✅ | `api/utils/envelope.ts` (`apiError`), `services/*/app/errors.py` | Machine-readable codes; `retryable` flag | — |
| API-3 | Cursor pagination (no offset) | ✅ | `api/queries/*.ts` (`cursor` params), `contracts/entities.ts` `Page<T>` | Consistent across list endpoints | — |
| API-4 | Versioned REST routes under `/v1` | ❌ | `api/boot.ts` | API is **tRPC at `/api/trpc/*` only**; none of the canonical REST URLs in `docs/API.md` (`GET /v1/jurisdictions/{id}/profile`, `POST /v1/opportunities/generate`, …) exist. `api_version:"v1"` is a string in the envelope, not a route | Either expose the documented REST facade or amend API.md; external consumers per spec cannot integrate today |
| API-5 | Idempotency-Key on mutating POSTs | 🟡 | `api/opportunities.ts`, `api/documents.ts` (idempotency_key inputs + unique index) | Real for jobs, but as a tRPC input field, not the `Idempotency-Key` HTTP header | Honor header at HTTP layer |
| API-6 | Health/readiness endpoint | 🟡 | `api/ops.ts` `ops.health` (tRPC) | **No `/healthz` HTTP route exists** — `infra/docker/docker-compose.yml` healthchecks for `app` (`node -e fetch …/healthz`) will fail; Python services do expose `/health` | Add `/healthz` route to Hono app |
| API-7 | §9.2 Recommendation output contract | ✅ | `contracts/entities.ts` (`Recommendation`), `api/bridges/ai.ts`, `services/ai/app/models.py` | Full contract incl. risk register, KPIs, legal deps, budget ranges | — |
| API-8 | Event schema pack (§40) | 🟡 | `contracts/entities.ts` (`EventTopics`) | Topic-name constants only; **no payload schemas, no producers, no consumers** | Define zod/JSON schemas per topic; implement emitter |
| API-9 | Service decomposition (§14, 19 services) | ❌ | repo layout | 3 deployables exist (app, simulation, ai). The other ~16 (connectors, parser, indexer, feature materializer, audit writer, DLQ replayer, etc.) exist only as doc tables | Either implement or re-scope §14 honestly |
| API-10 | Auth endpoints `GET /v1/auth/me`, `/permissions` | 🟡 | `api/auth-router.ts`, `api/context.ts` | Session/me exists via tRPC; no effective-permissions endpoint exposing jurisdiction grants | Add permissions endpoint backed by ABAC policy |

### Data model & storage (§16, §25)

| # | Requirement | Status | Evidence | Gap | Fix |
| --- | --- | --- | --- | --- | --- |
| DM-1 | MySQL operational store via Drizzle | ✅ | `db/schema.ts` (576 lines, 20 tables), `drizzle.config.ts` | Real and coherent | — |
| DM-2 | Full canonical entity coverage (Agency, Official, Budget, ProcurementRecord, Program, Facility, BusinessRegistration, Indicator/Observation) | ❌ | `db/schema.ts` | Missing: budgets, procurement records, facilities, officials, programs, business registrations, wards/boundaries. `sectorMetrics` is a thin stand-in for Indicator/Observation (no uniqueness on (indicator,jurisdiction,period)) | Extend schema to §16 entity list |
| DM-3 | SimulationRun reproducibility (manifest, dataset snapshot, `reproducibility_hash`) | 🟡 | `db/schema.ts` `simulationRuns` (seed, modelVersions); `services/simulation` `Reproducibility` model + `test_reproducibility.py` | Same-seed determinism is **tested and passing** in the Python service; but no `reproducibility_hash`/`dataset_snapshot_id` columns, no run manifest persisted to object storage from the gateway path | Persist manifest + hash per run |
| DM-4 | Iceberg lakehouse (ADR-005) | ❌ | grep: no iceberg code/config anywhere | Not present — no catalog, no tables, no snapshots | Stand up Iceberg on MinIO; route indicator history there |
| DM-5 | Trino analytical fabric (ADR-006) | 🟡 | `services/ai/app/retrieval/sql_adapter.py` `_search_trino` | A Trino code path exists but no Trino in compose/k8s, no DSN configured, path untested (`# pragma: no cover`); default is seeded-fallback | Add Trino to compose; integration test |
| DM-6 | MinIO/S3 object storage | 🟡 | compose `minio`+`minio-init`; `services/simulation/app/storage.py` | Bucket is created and simulation artifacts/twin states can persist there; **document uploads never touch object storage** (no upload endpoint, no `raw_object_uri`) | Implement document upload → S3 with checksum |
| DM-7 | Audit store | 🟡 | `db/schema.ts` `auditEvents`, `api/queries/audit.ts` | Append-only by convention in plain MySQL — mutable, no checksum chain, no WORM export, no 7-yr retention mechanism | WORM export job + checksum chaining |
| DM-8 | EvidenceSource registry metadata (license, cadence, quality score, privacy classification) | 🟡 | `db/schema.ts` `dataSources` | Table + admin CRUD exist; missing `license`, `quality_score`, `privacy_classification`, `jurisdiction_scope[]` fields from DATA_MODEL.md | Extend table; drive onboarding checklist from it |

### Ingestion & document/legal pipeline (§17–18)

| # | Requirement | Status | Evidence | Gap | Fix |
| --- | --- | --- | --- | --- | --- |
| ING-1 | Real external source connectors (NBS, NASS, Budget Office, CAC, BPP, GRID3, UBEC…) | ❌ | none exist | Zero lines of ingestion code. `db/seed.ts` (800 lines) is the only "pipeline". `dataSources.lastRefresh` is set by hand | Connector SDK + per-source pullers; store raw artifacts in MinIO with checksums |
| ING-2 | `ingest.raw.received` event on artifact arrival | ❌ | topic constant only | Never emitted | Emit from upload/connectors |
| ING-3 | Document upload API | 🟡 | `api/documents.ts` `register` | Registers **metadata only** — no binary upload, no content fetch of `source_uri`, no checksum computation | Multipart upload to S3 + parse job |
| ING-4 | OCR (Tesseract-class) | ❌ | `api/runner.ts` `documents.register` handler | Stub: `needsReview = (doc.ocrConfidence ?? 1) < 0.75` — the confidence is **caller-supplied**; no OCR engine anywhere | Tesseract/Textract-in-VPC worker |
| ING-5 | LexNLP legal extraction (obligations, actors, penalties) | ❌ | grep: no lexnlp | `clauses.obligations` JSON is seeded by hand | LexNLP worker producing obligations + review tasks |
| ING-6 | Akoma Ntoso legal XML | ❌ | grep: no akoma | No AKN parsing or serialization | Parse gazette AKN; map to law/clause model |
| ING-7 | Human-in-the-loop review queues | ✅ | `db/schema.ts` `reviewTasks`, `api/admin.ts` triage, `src/components/data-health/ReviewQueue.tsx` | Queue + triage + audit real | — |
| ING-8 | Airbyte / Dagster orchestration | ❌ | grep: zero references in code, infra, or docs | Not scaffolded even as containers | Choose orchestrator; add to compose + docs |

### Graph, retrieval, AI (§19–21, §37)

| # | Requirement | Status | Evidence | Gap | Fix |
| --- | --- | --- | --- | --- | --- |
| AI-1 | Neo4j knowledge graph (§19) | 🟡 | `services/ai/app/retrieval/graph_adapter.py` (`_search_neo4j` real bolt driver), compose `neo4j:5` | Adapter is real and will use Neo4j when `NEO4J_URI` set, **but nothing ever writes to Neo4j** — no graph indexer, no APOC seed load; default path traverses a hard-coded in-process edge list (`corpus.GRAPH_EDGES`) | Build graph indexer from MySQL/documents; load on boot |
| AI-2 | OpenSearch text+vector (§20) | 🟡 | `services/ai/app/retrieval/vector_adapter.py` (`_search_opensearch` real BM25 query), compose `opensearch:2` | Real query path, but BM25-only (no k-NN/embedding index), nothing indexes into OpenSearch, default is in-process TF-IDF over a ~dozen seeded passages | Indexer + k-NN mapping + embedding job |
| AI-3 | Hybrid fusion + rerank + citations (§20, ADR-007) | ✅ | `services/ai/app/retrieval/fusion.py` (RRF), `tests/test_fusion.py` passing | Fusion genuinely implemented and tested; inputs are fallback adapters by default | — |
| AI-4 | Gateway search uses hybrid retrieval | 🟡 | `api/search.ts` | Public search endpoint is **SQL `LIKE` + naive scoring**; hybrid service is only reached via copilot/recommendation bridges | Route `/v1/search` through `services/ai` `/v1/retrieve` |
| AI-5 | Qwen3 tier model serving via vLLM (ADR-001/003) | ❌ | `services/ai/app/llm/router.py`; compose `VLLM_BASE_URL` points at `localhost:8000` (nothing listens) | **No vLLM server, no model weights, no GPU manifest anywhere.** Default is `offline.py` template synthesizer. Router code is real (tested, 25 tests pass) but has never served a token | Deploy vLLM dev tier in staging; wire `VLLM_BASE_URL` |
| AI-6 | DeepSeek-R1 specialist tier w/ persisted reasoning traces (ADR-002) | 🟡 | `router.py` `ROUTING_POLICY` (`hard_analysis → deepseek_r1`) | Routing policy exists; no endpoint, no trace persistence (audit ring is in-memory, capacity 500) | Serve R1 asynchronously; persist traces to audit store |
| AI-7 | Ray Serve orchestration (ADR-004) | ❌ | grep: no ray import/deployment | `RAY_SERVE_URL` env var is set in compose but **no code reads it** | Either implement Ray layer or drop ADR-004 claim |
| AI-8 | Model routing records attached to `recommendations.generated` | 🟡 | `router.py` `RoutingAuditLog` (in-memory deque), `db/schema.ts` `briefs.modelRouting` | Routing decisions logged in-memory + structured logs; gateway fallback hard-codes `{tier:"offline-fallback"}`; not persisted to immutable audit | Persist routing record with generation |
| AI-9 | GPU sizing / pools (§37) | ❌ | `infra/k8s/base/ai.yaml` (no GPU requests/taints); `infra/terraform/main.tf` (placeholder comment) | Docs-only; no GPU node groups, no taints, no pool separation | Terraform GPU node groups + tainted pools per MODEL_STRATEGY |
| AI-10 | Prompt/eval harness, prompt regression (§21 operational controls) | ❌ | no eval code | Model "evals" absent; `prompt_bundle` is a string label only | Golden-task eval suite in `services/ai` |
| AI-11 | PII redaction before generation | ❌ | grep: none | Not implemented | Redaction stage in ai service |
| AI-12 | Embedding pipeline (batch tier) | ❌ | none | No embedding model or job exists | Nightly embedding job → OpenSearch k-NN |

### Simulation & digital twin (§22–23)

| # | Requirement | Status | Evidence | Gap | Fix |
| --- | --- | --- | --- | --- | --- |
| SIM-1 | Six engines (forecast, causal, microsim, ABM, system dynamics, optimization) | ✅ | `services/simulation/app/engines/*.py`, `tests/test_engines.py` passing | All six exist, deterministic, with uncertainty bands. **Caveat:** models are small parametric heuristics (e.g. optimization is a greedy knapsack, no scipy/Pyomo); fidelity far below "economic twin" ambition | Calibrate + document model validity |
| SIM-2 | Ensembles + uncertainty bands | ✅ | `engines/__init__.py` `band_from_samples`, `contracts` `BandPoint` | Percentile bands from seeded ensembles | — |
| SIM-3 | Reproducibility (same inputs+seed ⇒ identical output) | ✅ | `services/simulation/tests/test_reproducibility.py` (passing); `api/utils/prng.ts` mulberry32 in gateway fallback | Verified by test execution in this audit | — |
| SIM-4 | Four-layer digital twin (descriptive/behavioral/policy/adaptive) | 🟡 | `services/simulation/app/twin.py` | All four layers modeled and versioned, but **in-memory registry** (lost on restart unless artifact store configured), adaptive "calibration" is a fixed arithmetic drift heuristic, no learning from realized outcomes | Persist twin to DB/S3; real calibration loop |
| SIM-5 | Calibration & backtesting vs historical outcomes | ❌ | TESTING.md requires it; no backtest suite exists | Not implemented | Backtest harness + calibration report in release gate |
| SIM-6 | Scenario API end-to-end (create → run → results → compare) | ✅ | `api/scenarios.ts`, `api/bridges/simulation.ts`, `src/pages/Simulation.tsx` + components (trpc-wired), worker `services/simulation/app/worker.py` | Full loop works; gateway uses in-process fallback engines when service unreachable | — |

### Geospatial (§24)

| # | Requirement | Status | Evidence | Gap | Fix |
| --- | --- | --- | --- | --- | --- |
| GEO-1 | PostGIS store (boundaries, facilities, GRID3) | ❌ | compose runs `postgis:16-3.4`; `POSTGIS_URL` injected | **Zero code reads or writes PostGIS** — no schema, no geometry columns, no queries. Container is decorative | Create geo schema; load GRID3/OSGoF boundaries |
| GEO-2 | CesiumJS 3D/map front-end | ❌ | grep: no cesium in `package.json` or src | Not present | — |
| GEO-3 | Map UX | 🟡 | `src/components/shared/MapPanel.tsx` (SVG 6×4 LGA tile grid; optional MapLibre GL view when `geoJson` provided; `maplibre-gl` in package.json) | MapLibre path exists but **no GeoJSON boundaries exist anywhere in the repo** to feed it; default is the abstract tile grid, not a real choropleth | Ship Kaduna LGA/LGA-ward GeoJSON; serve from API |

### Eventing (§26)

| # | Requirement | Status | Evidence | Gap | Fix |
| --- | --- | --- | --- | --- | --- |
| EVT-1 | Redpanda backbone with topic catalog | 🟡 | compose `redpanda` service; `contracts/entities.ts` `EventTopics` | Broker runs; topics are never created by code; `KAFKA_BROKERS` env is injected but **no code reads it** (grep: zero matches in `api/` and `services/`) | Topic provisioning + client lib |
| EVT-2 | Producers/consumers, DLQs, retries, replay | ❌ | none | Job flow is direct in-process calls; `simulations.run.completed` etc. are only strings written into audit payloads | Implement consumer groups w/ retry/DLQ per EVENTS.md |

### Security & audit (§27)

| # | Requirement | Status | Evidence | Gap | Fix |
| --- | --- | --- | --- | --- | --- |
| SEC-1 | Keycloak OIDC as identity plane | ❌ | `api/kimi/auth.ts` (OAuth against `env.kimiAuthUrl` — Kimi, not Keycloak); compose `keycloak` service; realm import file is 26 lines, self-labelled "dev placeholder" | **The app never talks to Keycloak** — no Keycloak URL/JWKS reference in `api/` or `src/`. All sessions are Kimi OAuth cookies | Implement Keycloak OIDC code flow + JWKS verification; retire Kimi dependency |
| SEC-2 | RBAC role enforcement (6 roles) | ✅ | `api/utils/rbac.ts` (`requireRole`, `requireSignOff`), enforced in `admin.ts`, `briefs.ts`, `opportunities.ts`, `scenarios.ts`, `legislation.ts`; `db/schema.ts` `platformRole` | Genuinely enforced at gateway, incl. executive-only sign-off. Role names diverge slightly from SECURITY.md (`executive` vs `executive consumer`) | — |
| SEC-3 | Fine-grained dataset/document/jurisdiction ABAC | ❌ | none | No jurisdiction-scope checks on any query or retrieval; `publicQuery` endpoints expose all data unauthenticated | Policy middleware + retrieval filters |
| SEC-4 | Immutable 7-year audit (WORM, checksum-chained) | 🟡 | `db/schema.ts` `auditEvents`; every mutation calls `audit()` (`api/utils/envelope.ts`) | Writes are pervasive (good), but the store is a regular mutable MySQL table; no WORM export, no checksum chain, no retention config; audit-access-is-audited not implemented | WORM exporter + verification in DR drill |
| SEC-5 | Encryption in transit/at rest, Vault secrets | 🟡 | `infra/k8s/base/secrets-template.yaml` (Vault/ESO comments), prod `networkpolicy.yaml` | Sensible manifests; no TLS config in ingress, no Vault deployment, compose is plaintext | cert-manager + Vault/ESO wiring |
| SEC-6 | Container hardening, CodeQL, dependency scanning | 🟡 | `.github/workflows/codeql.yml`, k8s `securityContext` (runAsNonRoot, seccomp) | CodeQL workflow + non-root contexts exist; no dependency/container scan job in CI | Add trivy/npm-audit gates |

### Observability (§28)

| # | Requirement | Status | Evidence | Gap | Fix |
| --- | --- | --- | --- | --- | --- |
| OBS-1 | Prometheus scrape config + alert rules (SLO, freshness, job failures, lag) | 🟡 | `infra/monitoring/prometheus.yml`, `alerts.yml` (real, well-formed rules for p95>5s, job failure >5%, DataSourceStale, lag) | **Nothing exports the referenced metrics** — no prom-client in Node app, no prometheus client in Python services; `http_request_duration_seconds_bucket`, `jobs_failed_total`, `ingest_last_success_timestamp_seconds` never emitted; alerts would fire on absence or stay silent forever | Instrument all three services |
| OBS-2 | Grafana Platform Overview dashboard | ✅ | `infra/monitoring/grafana/dashboards/platform-overview.json` + provisioning | Dashboard + datasource provisioning real (awaits metrics) | — |
| OBS-3 | OpenTelemetry tracing | 🟡 | `infra/docker/otel-collector-config.yaml`, `OTEL_EXPORTER_OTLP_ENDPOINT` envs | Collector configured; **no OTel SDK instrumentation** in any service | Add OTel SDKs |

### Environments, CI/CD (§29–30)

| # | Requirement | Status | Evidence | Gap | Fix |
| --- | --- | --- | --- | --- | --- |
| ENV-1 | Dev compose full stack | ✅ | `infra/docker/docker-compose.yml` (13 services, healthchecks, volumes) | Genuinely complete — but app healthcheck targets nonexistent `/healthz` (see API-6) and seed/migration step is manual | Fix healthcheck; add migrate/seed job |
| ENV-2 | k8s dev/staging/prod overlays + canary | 🟡 | `infra/k8s/base/*`, `overlays/{dev,staging,prod}` | Real kustomize structure, NetworkPolicies, canary Deployment — but canary annotations commented out, no GPU pools, no isolated brokers per domain in prod overlay | Complete overlays per spec |
| ENV-3 | Terraform foundation | 🟡 | `infra/terraform/main.tf` | Self-described stub: modules `./modules/*` **do not exist in repo**; no provider blocks | Author modules or vendor real ones |
| ENV-4 | GitOps (Argo CD), promotion pipeline | ❌ | `infra/k8s/README.md` mentions flow; no ArgoCD manifests | Docs-only | ArgoCD ApplicationSets |
| CICD-1 | CI: typecheck, build, pytest, docker builds, CodeQL | 🟡 | `.github/workflows/ci.yml`, `codeql.yml` | Workflows real; **Node unit tests are not run in CI and are currently broken locally** (see TEST-1); no migrate step, no seed validation | Fix vitest config; add test job |
| CICD-2 | Contract/schema checks, E2E, k6 perf, model evals, dbt tests, canary bake, deploy | ❌ | absent from workflows | None of the release gates in TESTING.md are automated | Implement staged pipeline |

### Testing & NFRs (§31)

| # | Requirement | Status | Evidence | Gap | Fix |
| --- | --- | --- | --- | --- | --- |
| TEST-1 | Unit tests | 🟡 | `services/simulation/tests` (32 pass), `services/ai/tests` (25 pass), `api/tests/*.test.ts` | Python suites pass (verified by execution in this audit). **All 3 Node test files fail to load**: `TSConfckParseError: tsconfig.server.json not found` (referenced from repo config but missing) | Restore `tsconfig.server.json` or fix vitest aliasing |
| TEST-2 | Integration / E2E / UAT harnesses | ❌ | none | No testcontainers, Playwright, or Supertest flows | Compose-based E2E job |
| TEST-3 | NFR: availability 99.5%, p95<5s reads, p95<20s advisory, 100/20 concurrency | ❌ | alert rules exist; no k6 scripts, no load profiles, no SLI data | Unverifiable — no instrumentation and no load tests | k6 suites + metrics, run on staging |
| TEST-4 | NFR: RPO≤24h/RTO≤8h, DR drills | ❌ | DEPLOYMENT.md runbook only | No backup jobs/scripts (no mysqldump/neo4j-admin/pg_dump automation), no drill evidence | Backup cronjobs + timed drill script |
| TEST-5 | NFR: 100% reproducibility | 🟡 | simulation reproducibility tests pass | Generation reproducibility not covered (offline synth is deterministic, but no manifest re-run harness from the gateway) | Manifest re-run test |
| TEST-6 | NFR: 100% explainability (citations on every recommendation) | ✅ | `contracts/entities.ts` `evidence_base` (≥1 enforced by construction); EvidenceDrawer UI; citation fields mandatory | Contract-level guarantee holds for both remote and fallback paths | — |
| TEST-7 | NFR: localization without code changes | ❌ | `db/seed.ts` hard-codes Nigeria/Kaduna; `src/pages/Copilot.tsx` hard-codes `jur:ng-kd`; no i18n framework, no jurisdiction pack config | A second jurisdiction requires code edits | Config-driven jurisdiction packs + i18n scaffold |

### UX (§7.3) & mobile

| # | Requirement | Status | Evidence | Gap | Fix |
| --- | --- | --- | --- | --- | --- |
| UX-1 | Executive dashboard | ✅ | `src/pages/Dashboard.tsx` (643 lines, 10 tRPC calls), `src/components/dashboard/*` (KPIs, job-target tracker, approvals, scenarios, risks, activity) | Deep and live; data seeded | — |
| UX-2 | Opportunity rankings + compare | ✅ | `src/pages/Opportunities.tsx`, `components/opportunities/*` (ranking rows, compare tray/view, generate modal) | Full loop incl. async generation | — |
| UX-3 | Legislation explorer | ✅ | `src/pages/Legislation.tsx` (777 lines, 11 tRPC calls), instrument navigator, clause reader, citation trace modal | Rich; comparison workbench absent (SR-8) | — |
| UX-4 | Simulation studio | ✅ | `src/pages/Simulation.tsx`, `components/simulation/*` (builder, runs monitor, compare runs, artifacts) | Full loop via scenarios router | — |
| UX-5 | Briefs composer | ✅ | `src/pages/Briefs.tsx`, `components/briefs/*` (composer, preview, slide strip, sign-off flow) | Approval chain real; content template-based (SR-5) | — |
| UX-6 | Data source health console | ✅ | `src/pages/DataHealth.tsx` (769 lines), registry/freshness heatmap/pipeline board/review queue | Complete UX; telemetry seeded | — |
| UX-7 | Copilot screen | ✅ | `src/pages/Copilot.tsx` (615 lines), conversation rail, evidence panel, refusal pattern, offline banner | Mature; persistence in localStorage only | Server-side conversation store |
| UX-8 | PWA / offline tolerance | 🟡 | `vite-plugin-pwa` dep, `public/manifest.webmanifest`, `src/hooks/use-pwa.ts` | PWA scaffolded; no verified offline data strategy for low-connectivity rollout wave | Offline cache strategy + tests |
| MOB-1 | Capacitor mobile shell | 🟡 | `mobile/` (config, native.ts bridge, icons, android/ios scaffolds) | Bridge code complete but header states it is "intentionally NOT wired into the root app"; no built APK/AAB evidence | Wire + CI build for Android |
