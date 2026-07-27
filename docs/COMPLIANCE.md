# Compliance Audit — Jurisdiction Economic Intelligence & Policy Twin Platform

**Audit date:** 2025 (re-audit, code-as-found). **Method:** direct code inspection of `api/`, `db/`, `contracts/`, `services/` (incl. new `services/ingestion/`), `src/`, `mobile/`, `infra/`, `.github/`, plus **execution of every test suite in this audit**: Node/vitest **49 passed (8 files)**, simulation **32 passed**, ai **28 passed**, ingestion **26 passed**. Previous audit verdicts were not trusted; all 90 requirements re-verified against current code.

## Executive summary

**Overall: 33% FULLY implemented (30/90), 46% PARTIAL/scaffold (41/90), 21% NOT implemented (19/90) — 90 requirements assessed.**
Previous audit: 29% full / 39% partial / 32% missing. **Deltas: 26 improved, 64 unchanged, 0 regressed.**

Biggest movements since the last audit: a real ingestion service with 6 provenance-carrying connectors (ING-1, ING-2, SR-1); a mounted, contract-tested REST `/v1` facade with `/healthz` (API-4, API-5, API-6); gateway-emitted Prometheus metrics at `/metrics` (OBS-1); hash-chained tamper-evident audit with a verifier (SEC-4, DM-7); jurisdiction ABAC enforced on all jurisdiction-scoped mutations with tests (SEC-3, SR-10); a durable event outbox + Kafka producer + HMAC webhooks (EVT-1, EVT-2, API-8); populated brief citations rails + audited export (SR-5); a golden Q&A prompt-regression harness (AI-10); i18n packs + multi-jurisdiction onboarding packs (TEST-7); new canonical tables (facilities, procurement, ingestion_runs, twin_states, user_jurisdictions, event_outbox, webhooks) (DM-2); and a fully green test suite across all four codebases (TEST-1).

| Requested category | Reqs | FULL ✅ | PARTIAL 🟡 | NOT ❌ | Honest read |
| --- | --- | --- | --- | --- | --- |
| UX (§7.3 screens) | 7 | 7 (100%) | 0 | 0 | Strongest area; deep, live, trpc-wired — still over mostly seeded data |
| API & contracts | 10 | 5 (50%) | 4 | 1 | REST `/v1` facade real + tested; ~half the documented routes; 15 of 19 spec services still absent |
| Data model & storage | 8 | 1 (13%) | 6 | 1 | Schema grew to 30 tables with provenance columns; budgets/officials/programs/business registrations, boundaries, Iceberg still missing |
| Ingestion & doc/legal pipeline | 8 | 2 (25%) | 2 | 4 | Live connectors + pipeline + provenance real; **no OCR, LexNLP, Akoma Ntoso, or orchestrator; canonical records land in JSONL, not the platform DB** |
| AI/LLM | 12 | 2 (17%) | 5 | 5 | Regression harness added; **still no vLLM/Qwen3/Ray, no PII redaction, no embedding pipeline** |
| Simulation & twin | 6 | 4 (67%) | 1 | 1 | Engines deterministic + tested; twin state now persisted; no backtesting |
| Security & audit | 6 | 1 (17%) | 4 | 1 | RBAC + ABAC + hash-chained audit real; **Keycloak still unwired (Kimi OAuth only)**; no WORM/retention |
| Observability | 3 | 1 (33%) | 2 | 0 | Gateway now emits the alert-referenced metrics; Python services still uninstrumented; no OTel SDK |
| Infra/deployment & CI/CD | 6 | 1 (17%) | 3 | 2 | Compose full but **ingestion service not in compose**; CI still doesn't run vitest or ingestion tests; no deploy/GitOps |
| Testing & NFRs | 6 | 2 (33%) | 2 | 2 | All four suites green (115 tests, executed here); REST contract tests exist; **no k6/E2E-browser/DR drills** |
| Mobile/PWA | 2 | 0 | 2 (100%) | 0 | Both still scaffold-only; mobile bridge intentionally unwired |
| Localization | 1 | 0 | 1 (100%) | 0 | i18n packs (en/ha/ig/yo) + 3 jurisdiction packs exist; UI strings largely not externalized; pages still hard-code `jur:ng-kd` |
| System/business (SR) + geospatial + eventing | 15 | 4 (27%) | 9 | 2 | ABAC + events improved SR-9/SR-10; PostGIS/Cesium still decorative; consumers/DLQ absent |
| **TOTAL (90)** | **90** | **30 (33%)** | **41 (46%)** | **19 (21%)** | |

**Bottom line:** The platform has moved from "product demo over seed data" toward the specified system: ingestion is real code with live HTTP connectors and end-to-end provenance, the REST facade exists and is contract-tested, audit is tamper-evident, authorization is jurisdiction-scoped on writes, events are durable, and every test suite passes. It is **still not** the full spec: no LLM is actually served (offline template synthesizer remains the default), the document/legal pipeline (OCR/LexNLP/AKN) is absent, ingested data does not yet flow into the operational DB or the UI, Keycloak/PostGIS/Trino/Iceberg remain containers-without-callers, and no NFR (availability, latency, DR) is verifiably met.

---

## Full requirement matrix

Legend: ✅ fully implemented (works end-to-end, cited) · 🟡 partial/scaffold · ❌ not implemented · Delta vs previous audit: improved / unchanged / regressed

### SR / BR system & business requirements

| # | Requirement | Status | Delta | Evidence path | Gap description | Recommended fix |
| --- | --- | --- | --- | --- | --- | --- |
| SR-1 | Continuous ingestion of official statistics, legislation, budgets, procurement, geodata | 🟡 | improved | `services/ingestion/app/connectors/*` (worldbank, hdx, overpass, nada, budeshi, file_harvester), `pipeline.py`, `api/onboarding.ts`, `db/schema.ts ingestionRuns` | 6 real connectors with provenance + contract checks + JSONL artifacts exist and are tested (26 tests). **But:** no loader writes canonical records into MySQL (`sectorMetrics` etc. remain seed); no scheduling/cadence; NBS, NASS, Budget Office, CAC, BPP, GRID3 have no connectors; ingestion not in docker-compose | Loader job: JSONL → canonical tables; add NBS/CAC connectors; add service to compose + scheduler |
| SR-2 | Canonical jurisdiction-partitioned model | 🟡 | improved | `db/schema.ts` (`adminLevelEnum` incl. `ward`, provenance columns `origin/source_url/fetched_at` on jurisdictions/adminUnits/sectorMetrics) | Ward level + provenance metadata added. Still no `geometry_ref`/boundary linkage, no population-source-year metadata | Backfill boundary refs; metadata per DATA_MODEL.md |
| SR-3 | Evidence-grounded recommendations (citations) | ✅ | unchanged | `contracts/entities.ts` (`evidence_base` ≥1), `api/runner.ts`, `services/ai/app/llm/offline.py` | Contract-level guarantee holds on both paths | — |
| SR-4 | What-if simulation | ✅ | unchanged | `services/simulation/app/engines/*.py`, tests 32 passed (executed) | Simplified parametric heuristics, not calibrated | Calibration/backtesting |
| SR-5 | Executive briefs with citations rail | 🟡 | improved | `api/runner.ts` (citations rail built from linked + jurisdiction evidence sources, ≥3 guaranteed, tested by `api/tests/briefs-citations.test.ts`), `api/briefs.ts exportMeta` (audited export) | Citations rail is now real; **section body text is still 4 hard-coded template paragraphs**; export is metadata+audit only, no generated PDF/DOCX artifact | Generate sections from retrieval bundle; render real export artifacts |
| SR-6 | Data source health console | ✅ | unchanged | `api/admin.ts`, `api/ops.ts`, `src/pages/DataHealth.tsx`; now backed by real `ingestion_runs` records from onboarding | Console real; freshness values still largely seed until loader lands (SR-1) | Wire freshness to ingestion telemetry |
| SR-7 | Copilot Q&A with evidence panel | ✅ | unchanged | `src/pages/Copilot.tsx`, `api/bridges/ai.ts`, `services/ai` `/v1/copilot/query` | Works end-to-end; offline template synthesizer unless vLLM configured | Serve a model tier (AI-5) |
| SR-8 | Legislation workbench | 🟡 | unchanged | `api/legislation.ts`, `src/pages/Legislation.tsx`, REST `POST /v1/legislation/graph-query` | **No compare endpoint** (`POST /v1/legislation/compare` still absent); clauses seeded, not parsed | Compare endpoint + specialist analysis path |
| SR-9 | Async job architecture (202 + job handle + idempotency) | 🟡 | improved | `api/utils/jobs.ts`, `api/runner.ts` (DB-persisted jobs), `api/utils/events.ts emitJobLifecycle` (emits on queued/succeeded/failed) | Jobs are DB-persisted with idempotency dedup and now emit lifecycle events; **runner is still a singleton in-process loop — lost on restart mid-flight, no distribution, no DLQ** | Redpanda-backed workers + DLQ |
| SR-10 | Jurisdiction-partitioned tenancy / data sovereignty | 🟡 | improved | `api/utils/rbac.ts assertJurisdictionAccess` + `user_jurisdictions` grants, enforced in scenarios/opportunities/briefs/legislation/innovations mutations; `api/tests/abac.test.ts` (5 tests pass) | Write-side ABAC genuinely enforced and tested. **Read paths (`publicQuery` list/get endpoints) remain unscoped and unauthenticated; retrieval has no jurisdiction filter** | Scope reads + retrieval filters by actor grants |

### API & contracts (§15, §38–40)

| # | Requirement | Status | Delta | Evidence | Gap | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| API-1 | Standard envelope `{data, meta, audit}` | ✅ | unchanged | `api/utils/envelope.ts`, all 3 Python services `_envelope`/`Envelope` | Holds incl. new ingestion service | — |
| API-2 | Structured error envelopes | ✅ | unchanged | `api/utils/envelope.ts`, `services/*/app/errors.py` (ingestion included) | — | — |
| API-3 | Cursor pagination (no offset) | ✅ | unchanged | `api/queries/*.ts`, `contracts Page<T>` | — | — |
| API-4 | Versioned REST routes under `/v1` | 🟡 | improved | `api/rest.ts` mounted at `/v1` in `api/boot.ts`; `api/tests/rest.test.ts` contract tests pass (healthz, envelope, jurisdictions, profile, search) | Facade is real but covers ~10 routes; documented `GET /v1/auth/me|permissions`, `/v1/sectors`, `POST /v1/documents`, `GET /v1/briefs/{id}`, `/v1/admin/*`, `/v1/observability/*` absent; brief create is `POST /v1/briefs` vs documented `POST /v1/briefs/generate` | Complete route coverage or amend API.md |
| API-5 | Idempotency-Key on mutating POSTs | 🟡 | improved | `api/rest.ts` (header honored + 400 `IDEMPOTENCY_KEY_REQUIRED` on `/v1/opportunities/generate`; header fallback on scenario runs/briefs) | Header enforced only on opportunities/generate; other mutations auto-generate a key if absent; tRPC surface still uses a body field | Uniform header middleware on all mutating REST POSTs |
| API-6 | Health/readiness endpoint | ✅ | improved | `api/boot.ts` `GET /healthz` returns 200 JSON; verified by `rest.test.ts`; compose healthcheck now valid | Readiness is shallow (no DB check) | Add dependency probes |
| API-7 | §9.2 Recommendation output contract | ✅ | unchanged | `contracts/entities.ts`, `services/ai/app/models.py` | — | — |
| API-8 | Event schema pack (§40) | 🟡 | improved | `api/utils/events.ts` (DomainEvent envelope, outbox persistence, webhook fan-out), `services/ingestion/app/events.py` | Real payloads + delivery exist; **no per-topic zod/JSON schema validation, no schema registry** | Define per-topic payload schemas; validate on emit |
| API-9 | Service decomposition (§14, 19 services) | ❌ | improved | repo layout: 4 deployables (app, simulation, ai, ingestion) | Still ~15 spec services (parser, indexer, feature materializer, audit writer, DLQ replayer…) absent | Implement or re-scope §14 |
| API-10 | Auth endpoints `GET /v1/auth/me`, `/permissions` | 🟡 | unchanged | `api/auth-router.ts` (`me` via tRPC), `api/queries/users.ts jurisdictionsForUser` | Grants resolver exists but **no effective-permissions endpoint** exposes it | Add permissions endpoint over user_jurisdictions + role |

### Data model & storage (§16, §25)

| # | Requirement | Status | Delta | Evidence | Gap | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| DM-1 | MySQL operational store via Drizzle | ✅ | unchanged | `db/schema.ts` (817 lines, 30 tables), migration `0000_init.sql` | — | — |
| DM-2 | Full canonical entity coverage | 🟡 | improved | `db/schema.ts`: new `facilities`, `procurementRecords`, `ingestionRuns`, `twinStates`, `sectorMultipliers`, `scenarioTemplates`, `userJurisdictions`, `eventOutbox`, `webhookSubscriptions` | Still missing: **budgets, officials, programs, business registrations, wards/boundaries geometry**; `sectorMetrics` still a thin Indicator/Observation stand-in (no (indicator,jurisdiction,period) uniqueness) | Extend schema to §16 list |
| DM-3 | SimulationRun reproducibility (manifest, snapshot, `reproducibility_hash`) | 🟡 | unchanged | `simulationRuns` (seed, modelVersions); `test_reproducibility.py` passes | No `reproducibility_hash`/`dataset_snapshot_id` columns; no persisted manifest from gateway path | Persist manifest + hash |
| DM-4 | Iceberg lakehouse (ADR-005) | ❌ | unchanged | grep: no iceberg code/config | — | Iceberg on MinIO |
| DM-5 | Trino analytical fabric (ADR-006) | 🟡 | unchanged | `services/ai/app/retrieval/sql_adapter.py _search_trino` | Code path only; no Trino deployed/configured/tested | Compose + integration test |
| DM-6 | MinIO/S3 object storage | 🟡 | unchanged | compose minio; `services/simulation/app/storage.py`; `@aws-sdk/client-s3` now in package.json **but unreferenced by any code** | Document uploads still metadata-only; ingestion artifacts go to local JSONL dir, not S3 | Wire uploads + ingestion artifacts to S3 with checksums |
| DM-7 | Audit store | 🟡 | improved | `api/utils/auditchain.ts` (sha256 prev/entry hash chain, serialized appends, `verifyAuditChain` tamper detection), `auditEvents.prevHash/entryHash` columns, `api/tests/auditchain.test.ts` passes (tamper detected) | Tamper-**evident** now, but store is still a mutable MySQL table — an attacker with DB write can re-chain; no WORM export, no 7-yr retention mechanism | WORM/object-lock export + anchored checkpoints |
| DM-8 | EvidenceSource registry metadata | 🟡 | improved | `dataSources` gained `contractCompliance` (schema/sla/license ok) + `geographyScope` | Still no `license`, `quality_score`, `privacy_classification`, `jurisdiction_scope[]` columns | Extend table |

### Ingestion & document/legal pipeline (§17–18)

| # | Requirement | Status | Delta | Evidence | Gap | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| ING-1 | Real external source connectors | 🟡 | improved | `services/ingestion/app/connectors/`: worldbank (live, any ISO3), hdx, overpass (OSM facilities), nada, budeshi (procurement), file_harvester; provenance (origin/source/url/checksum/license) on every record; 26 tests pass | Real HTTP connectors exist; **NBS, NASS, Budget Office, CAC, BPP, GRID3 absent**; no scheduling; not in compose | Add priority Nigerian connectors; compose entry + cron |
| ING-2 | `ingest.raw.received` event on artifact arrival | ✅ | improved | `services/ingestion/app/pipeline.py` emits on every fetch; `events.py` Kafka producer when `KAFKA_BROKERS` set (noop stdout adapter otherwise) | Emission real and tested; delivery to broker requires optional kafka-python extra | — |
| ING-3 | Document upload API | 🟡 | unchanged | `api/documents.ts register` | Metadata-only; no binary upload, no content fetch of `source_uri`, no checksum computation | Multipart upload → S3 + parse job |
| ING-4 | OCR (Tesseract-class) | ❌ | unchanged | `ocr_confidence` remains caller-supplied | No OCR engine anywhere | Tesseract worker |
| ING-5 | LexNLP legal extraction | ❌ | unchanged | grep: no lexnlp; clauses/obligations seeded | — | LexNLP worker |
| ING-6 | Akoma Ntoso legal XML | ❌ | unchanged | grep: no akoma | — | AKN parser |
| ING-7 | Human-in-the-loop review queues | ✅ | unchanged | `reviewTasks`, `api/admin.ts` triage, `ReviewQueue.tsx` | — | — |
| ING-8 | Airbyte / Dagster orchestration | ❌ | unchanged | grep: zero references | — | Choose + add orchestrator |

### Graph, retrieval, AI (§19–21, §37)

| # | Requirement | Status | Delta | Evidence | Gap | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| AI-1 | Neo4j knowledge graph | 🟡 | unchanged | `graph_adapter.py` (real bolt driver), compose neo4j | Nothing writes to Neo4j; default is hard-coded edge list | Graph indexer |
| AI-2 | OpenSearch text+vector | 🟡 | unchanged | `vector_adapter.py` (BM25), compose opensearch | No indexer, no k-NN/embedding index | Indexer + k-NN |
| AI-3 | Hybrid fusion + rerank + citations | ✅ | unchanged | `fusion.py` (RRF), tests pass | — | — |
| AI-4 | Gateway search uses hybrid retrieval | 🟡 | unchanged | `api/search.ts` — still SQL LIKE + naive scoring (`adapter: "sql-like-fallback"`); `search.ask` uses the AI bridge | Public `/v1/search` does not route through the hybrid service | Route search through `/v1/retrieve` |
| AI-5 | Qwen3 tier serving via vLLM | ❌ | unchanged | `router.py` real; no server, weights, or GPU manifest; default `offline.py` | **No model has ever been served** | Deploy vLLM dev tier |
| AI-6 | DeepSeek-R1 specialist tier w/ persisted traces | 🟡 | unchanged | `ROUTING_POLICY`; routing audit ring still in-memory (capacity 500) | No endpoint, no trace persistence | Persist traces to audit store |
| AI-7 | Ray Serve orchestration | ❌ | unchanged | grep: no ray import; `RAY_SERVE_URL` unread | — | Implement or drop ADR-004 |
| AI-8 | Model routing records on `recommendations.generated` | 🟡 | improved | `api/bridges/ai.ts` increments `llm_routing_decisions_total{tier}` (remote vs offline-fallback); `briefs.modelRouting` | Metric now emitted; routing record still not persisted to immutable audit; gateway fallback still hard-codes `offline-fallback` | Persist routing record per generation |
| AI-9 | GPU sizing / pools | ❌ | unchanged | `infra/k8s/base/ai.yaml` (no GPU), terraform stub | — | Terraform GPU node groups |
| AI-10 | Prompt/eval harness, prompt regression | ✅ | improved | `services/ai/app/regression.py` (10-question golden set: citation presence, contract completeness, determinism), `GET /v1/regression/latest`, `tests/test_regression.py` passes | Offline-golden only; no evals against a served model | Extend to live-model evals when AI-5 lands |
| AI-11 | PII redaction before generation | ❌ | unchanged | grep: no redaction code | — | Redaction stage |
| AI-12 | Embedding pipeline (batch tier) | ❌ | unchanged | none | — | Nightly embedding job |

### Simulation & digital twin (§22–23)

| # | Requirement | Status | Delta | Evidence | Gap | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| SIM-1 | Six engines | ✅ | unchanged | `engines/*.py`, 32 tests pass (executed) | Small parametric heuristics (greedy knapsack optimization) | Calibrate + document validity |
| SIM-2 | Ensembles + uncertainty bands | ✅ | unchanged | `band_from_samples`, `BandPoint` | — | — |
| SIM-3 | Reproducibility | ✅ | unchanged | `test_reproducibility.py` passes; `api/utils/prng.ts` | — | — |
| SIM-4 | Four-layer digital twin | 🟡 | improved | `db/schema.ts twinStates` (versioned, per jurisdiction+layer), `api/runner.ts` (`twinStatesFor`/`upsertTwinState`, adaptive recalibration from live metrics); `services/simulation/app/twin.py` (4 layers) | Twin state now persists across restarts via DB; calibration is still a heuristic drift from metric deltas, no learning from realized outcomes; Python service registry still in-process (artifact store optional) | Real calibration loop vs outcomes |
| SIM-5 | Calibration & backtesting vs historical outcomes | ❌ | unchanged | grep: no backtest suite | — | Backtest harness in release gate |
| SIM-6 | Scenario API end-to-end | ✅ | unchanged | `api/scenarios.ts`, `Simulation.tsx`, worker | — | — |

### Geospatial (§24)

| # | Requirement | Status | Delta | Evidence | Gap | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| GEO-1 | PostGIS store | ❌ | unchanged | compose postgis runs; **zero code reads/writes it** (grep confirms) | Container decorative | Geo schema + GRID3 load |
| GEO-2 | CesiumJS front-end | ❌ | unchanged | grep: no cesium | — | — |
| GEO-3 | Map UX | 🟡 | unchanged | `MapPanel.tsx` (SVG tile grid; MapLibre path if GeoJSON supplied) | No GeoJSON boundaries anywhere in repo | Ship LGA/ward GeoJSON |

### Eventing (§26)

| # | Requirement | Status | Delta | Evidence | Gap | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| EVT-1 | Redpanda backbone with topic catalog | 🟡 | improved | `api/utils/events.ts` (kafkajs producer when `KAFKA_BROKERS` set, durable `event_outbox` fallback + relay), `services/ingestion/app/events.py` | Producers real now; **topics never provisioned by code; no consumer ever subscribes** | Topic provisioning + first consumer |
| EVT-2 | Producers/consumers, DLQs, retries, replay | 🟡 | improved | outbox relay with attempt counter + `lastError`; webhook fan-out with HMAC-SHA256 signatures and 3-retry exponential backoff | No consumer groups, no DLQ topic, no replay tooling; outbox rows without Kafka accumulate forever | Consumers + DLQ per EVENTS.md |

### Security & audit (§27)

| # | Requirement | Status | Delta | Evidence | Gap | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| SEC-1 | Keycloak OIDC identity plane | ❌ | unchanged | `api/kimi/auth.ts` (Kimi OAuth); no Keycloak URL/JWKS reference in code; realm file still dev placeholder | **App never talks to Keycloak** | Keycloak code flow + JWKS |
| SEC-2 | RBAC role enforcement (6 roles) | ✅ | unchanged | `api/utils/rbac.ts requireRole/requireSignOff`, enforced across routers | — | — |
| SEC-3 | Fine-grained dataset/document/jurisdiction ABAC | 🟡 | improved | `assertJurisdictionAccess` + `user_jurisdictions` (read/write/admin levels), enforced on all jurisdiction-scoped mutations; `abac.test.ts` passes | Jurisdiction-level write ABAC real; **reads/retrieval unscoped; no dataset- or document-level policies** | Extend to read paths + retrieval |
| SEC-4 | Immutable 7-year audit (WORM, checksum-chained) | 🟡 | improved | `auditchain.ts` (chain + full-replay verifier, tests prove tamper detection); every mutation still calls `audit()` | Checksum chain ✅; WORM export ❌; retention config ❌; audit-access-is-audited ❌ | WORM exporter + retention + access auditing |
| SEC-5 | Encryption in transit/at rest, Vault secrets | 🟡 | unchanged | k8s secrets-template comments, prod NetworkPolicy | No TLS in ingress, no Vault deployment | cert-manager + Vault/ESO |
| SEC-6 | Container hardening, CodeQL, dependency scanning | 🟡 | unchanged | `codeql.yml`, k8s securityContext | Still no dependency/container scan gate | trivy/npm-audit gates |

### Observability (§28)

| # | Requirement | Status | Delta | Evidence | Gap | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| OBS-1 | Prometheus scrape + alert rules | 🟡 | improved | `api/utils/metrics.ts` (zero-dep registry: `http_request_duration_seconds_bucket`, `jobs_total/failed`, `simulation_runs_total`, `llm_routing_decisions_total`, `ingestion_records_total`, `events_emitted_total`), `GET /metrics` wired in `boot.ts` with HTTP middleware | Gateway now emits real metrics; **Python services (ai/simulation/ingestion) emit none**; some alert-referenced series still absent (`ingest_last_success_timestamp_seconds`, consumer lag) | Instrument Python services; add missing series |
| OBS-2 | Grafana Platform Overview dashboard | ✅ | unchanged | dashboard JSON + provisioning | — | — |
| OBS-3 | OpenTelemetry tracing | 🟡 | unchanged | otel-collector config + envs; **no OTel SDK in any service** (grep confirms) | — | Add OTel SDKs |

### Environments, CI/CD (§29–30)

| # | Requirement | Status | Delta | Evidence | Gap | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| ENV-1 | Dev compose full stack | ✅ | unchanged | `docker-compose.yml` (14 services, healthchecks; app `/healthz` now exists so healthcheck is valid) | **Ingestion service missing from compose**; seed/migration still manual | Add ingestion service + migrate job |
| ENV-2 | k8s overlays + canary | 🟡 | unchanged | base + dev/staging/prod overlays | Canary annotations still commented; no GPU pools | Complete overlays |
| ENV-3 | Terraform foundation | 🟡 | unchanged | `main.tf` — modules `./modules/*` still nonexistent | — | Author modules |
| ENV-4 | GitOps (Argo CD) | ❌ | unchanged | docs only | — | ArgoCD ApplicationSets |
| CICD-1 | CI: typecheck, build, pytest, docker builds, CodeQL | 🟡 | unchanged | `ci.yml` (node typecheck+build, pytest matrix **[simulation, ai]**, docker builds, codeql) | **CI still does not run vitest (49 tests) and the ingestion service is absent from the pytest matrix**; no migrate/seed validation | Add vitest job + ingestion matrix entry |
| CICD-2 | Contract/E2E/k6/evals/dbt/canary/deploy gates | ❌ | unchanged | absent from workflows | — | Staged pipeline |

### Testing & NFRs (§31)

| # | Requirement | Status | Delta | Evidence | Gap | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| TEST-1 | Unit tests | ✅ | improved | **Executed in this audit:** vitest 49/49 (8 files: envelope, jobs, bridges, rest, abac, auditchain, briefs-citations, innovations); simulation 32/32; ai 28/28; ingestion 26/26. `tsconfig.server.json` restored | All suites green locally; CI doesn't run node/ingestion tests (CICD-1) | Wire into CI |
| TEST-2 | Integration / E2E / UAT harnesses | 🟡 | improved | `api/tests/rest.test.ts` (Hono `app.request` contract tests against seeded dev DB), `services/ingestion/tests/test_api.py` | Real API-level integration tests exist; no browser E2E (Playwright), no compose-level E2E, no UAT harness | Compose E2E + Playwright |
| TEST-3 | NFR: availability 99.5%, p95<5s/20s, concurrency | ❌ | unchanged | alert rules exist; no k6 scripts, no load profiles | Unverifiable | k6 suites on staging |
| TEST-4 | NFR: RPO≤24h/RTO≤8h, DR drills | ❌ | unchanged | runbook only; no backup jobs/scripts | — | Backup cronjobs + drill |
| TEST-5 | NFR: 100% reproducibility | 🟡 | unchanged | simulation reproducibility tested; generation manifest re-run harness absent | — | Manifest re-run test |
| TEST-6 | NFR: 100% explainability (citations) | ✅ | unchanged | `evidence_base` ≥1 enforced; briefs rail now populated + tested | — | — |
| TEST-7 | NFR: localization without code changes | 🟡 | improved | `src/i18n/` (en/ha/ig/yo dicts + `LanguageSwitcher`), `onboarding/packs/` (kaduna-ng, lagos-ng, nairobi-ke with live samples + schema) | Language packs + multi-jurisdiction packs exist, **but only the onboarding page consumes i18n; core pages still hard-code strings and `jur:ng-kd`** (grep: Copilot, Briefs, DataHealth, Opportunities…) | Externalize UI strings; jurisdiction from session/config |

### UX (§7.3) & mobile

| # | Requirement | Status | Delta | Evidence | Gap | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| UX-1 | Executive dashboard | ✅ | unchanged | `Dashboard.tsx` + `components/dashboard/*` | Data seeded | — |
| UX-2 | Opportunity rankings + compare | ✅ | unchanged | `Opportunities.tsx` + compare tray | — | — |
| UX-3 | Legislation explorer | ✅ | unchanged | `Legislation.tsx` (navigator, clause reader, citation trace) | Comparison workbench absent (SR-8) | — |
| UX-4 | Simulation studio | ✅ | unchanged | `Simulation.tsx` + studio components | — | — |
| UX-5 | Briefs composer | ✅ | unchanged | `Briefs.tsx` + sign-off flow; citations rail now real (SR-5) | Body text template-based | — |
| UX-6 | Data source health console | ✅ | unchanged | `DataHealth.tsx` | Telemetry mostly seeded (SR-1) | — |
| UX-7 | Copilot screen | ✅ | unchanged | `Copilot.tsx` (evidence panel, refusal, offline banner) | Persistence localStorage only | Server-side conversation store |
| UX-8 | PWA / offline tolerance | 🟡 | unchanged | vite-plugin-pwa, manifest, `use-pwa.ts` | No verified offline data strategy | Offline cache strategy + tests |
| MOB-1 | Capacitor mobile shell | 🟡 | unchanged | `mobile/` — `native.ts` header still states it is "intentionally NOT wired into the root app" | No built APK/AAB evidence | Wire + CI Android build |

---

## Remaining gaps ranked by user impact (with next actions)

1. **No LLM is served (AI-5, AI-6, AI-7 ❌/🟡).** Copilot, recommendations, and briefs are deterministic template output. *Next:* deploy a vLLM dev tier (small Qwen) in staging, set `VLLM_BASE_URL`, verify `llm_routing_decisions_total{tier="remote"}` moves.
2. **Document/legal pipeline absent (ING-4, ING-5, ING-6, ING-3 ❌/🟡).** No OCR, LexNLP, or Akoma Ntoso; all legislation content is hand-seeded; document "upload" is metadata-only. *Next:* S3 multipart upload + checksum, Tesseract worker, LexNLP extraction writing `clauses.obligations` + review tasks.
3. **Identity plane is not the spec's (SEC-1 ❌).** All sessions are Kimi OAuth; Keycloak container is decorative. *Next:* Keycloak OIDC code flow + JWKS verification behind `authenticateRequest`, realm roles → `platformRole`.
4. **Ingested data never reaches the product (SR-1, ING-1 🟡).** Connectors write JSONL artifacts; nothing loads canonical records into MySQL, so dashboards/health remain seed-backed; ingestion service is absent from compose. *Next:* loader job (JSONL → `sectorMetrics`/`facilities`/`procurementRecords` with provenance), add service + scheduler to compose, add NBS/CAC connectors.
5. **Geospatial stack is dead code (GEO-1, GEO-2, GEO-3 ❌/🟡).** PostGIS unused, zero boundary GeoJSON, no Cesium. *Next:* geo schema + GRID3/Kaduna LGA-ward boundaries, serve GeoJSON from API to the existing MapLibre path.
6. **Canonical model incomplete (DM-2, DM-4, DM-5 🟡/❌).** Budgets, officials, programs, business registrations, boundaries missing; no Iceberg/Trino deployment. *Next:* extend schema per §16; stand up Iceberg on MinIO for indicator history.
7. **Safety/compliance controls missing (AI-11, AI-12, SEC-4 ❌/🟡).** No PII redaction before generation, no embedding pipeline; audit chain is tamper-evident but not WORM/7-yr. *Next:* redaction stage in ai service; nightly embedding job → OpenSearch k-NN; WORM export with anchored checkpoints.
8. **Eventing is one-way (EVT-1, EVT-2, SR-9 🟡).** Producers/outbox exist but nothing consumes; jobs still run in a single in-process loop (lost on restart, no DLQ). *Next:* provision topics, move job dispatch to consumer groups with retry/DLQ.
9. **No NFR is verifiably met (TEST-3, TEST-4 ❌).** No k6 load suites, no backup automation, no DR drill evidence. *Next:* k6 read/advisory profiles on staging; mysqldump/neo4j backup cronjobs + timed restore drill.
10. **Release pipeline incomplete (CICD-1, CICD-2, ENV-4 🟡/❌).** CI doesn't run the (now-green) vitest suite or ingestion tests; no contract/E2E/eval gates, no deploy/GitOps. *Next:* add vitest + ingestion jobs to `ci.yml`, staged gates per TESTING.md, ArgoCD ApplicationSets.
