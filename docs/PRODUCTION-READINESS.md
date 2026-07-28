# Production Readiness Scorecard — Meridian Policy Twin Platform

**Audit date:** 2026-07-28 · code at `master` 07470ac · auditor: independent final verification (all test suites re-executed in this audit; see `docs/COMPLIANCE.md` for the spec-completion matrix).

This scorecard is **separate from spec completion** (**81.7% weighted** as of the final round — see below): it grades how close the platform is to running in production, on 10 dimensions scored 0–10.

**Weights** (sum = 100%): functionality 15% · code quality 10% · tests/CI 15% · security 10% · data/provenance 5% · observability/ops 5% · deployment automation 10% · scalability/performance 5% · AI/LLM readiness 15% · documentation 5%.

**Overall production readiness: 7.1 / 10** (weighted average; see table).

| Dimension | Score | Weight | Evidence | Deductions |
| --- | --- | --- | --- | --- |
| (a) Functionality completeness vs spec | **8** | 15% | **63/90 full, 21 partial, 6 missing; weighted 81.7% (≥80% target met).** Final round closed DM-2 (full canonical entity coverage), DM-8 (source registry metadata), DM-3 (run manifests + reproducibility hashes), TEST-5 (re-run harness), API-8 (zod event schema pack), EVT-1 (codified topic catalog), AI-8 (routing records → audit store) — all with executed tests (data-contracts 20, event-schemas 4, topic-catalog 4, run-manifest 2, routing-audit 2). All 7 core screens live; document pipeline (OCR→legal NLP→AKN), loader, hybrid search, consumers/DLQ, WORM audit landed and tested | −1 no served LLM (advisory features are template output); −1 lakehouse/orchestration/19-service decomposition absent; residual gaps now narrow (NBS/CAC connectors, backtesting, mobile) |
| (b) Code quality & type safety | **8** | 10% | `tsc -b` **clean (executed in this audit)**; shared contract package (`contracts/`) enforced across TS+Python boundaries; zero-dep metrics/envelope libraries vendored consistently; structured errors everywhere | −1 ESLint config exists but no lint gate in CI and lint not executed here; −1 vendored `metrics.py` copies must be kept in sync manually |
| (c) Test coverage & CI gates | **8** | 15% | **Executed:** merged-tree gate run by the orchestrator: **vitest 200/200 passed (31 files)** + pytest **185/185** (simulation 33, ai 75, ingestion 50, documents 27) + `tsc -b` typecheck clean; CI runs typecheck, vitest, pytest×4, data-contracts, E2E (23 checks) + perf smoke on a MySQL service, docker builds, CodeQL | −1 no browser E2E (Playwright) and no coverage % gates; −1 PWA tests need `jsdom` (dev dep) — absent from a production-only install; k6 never run on staging |
| (d) Security posture | **7** | 10% | RBAC (6 roles) + dataset/document-level ABAC (`dataset_policies`) + jurisdiction-scoped reads *and* writes, all test-covered; hash-chained audit + WORM export with S3 Object-Lock COMPLIANCE + sealed-manifest tests; PII redaction middleware; OIDC/Keycloak path with mock-issuer tests; CodeQL | −1 Kimi OAuth still the default IdP (Keycloak opt-in); −1 no TLS in ingress, no Vault/ESO; −1 no dependency/container scan gate; audit chain not externally anchored |
| (e) Data & provenance integrity | **7** | 5% | Provenance columns + per-record origin/source/checksum/license in connectors; contract compliance flags; canonical loader with `latestMetricsPreferringLive`; **EvidenceSource registry now carries license/qualityScore/privacyClassification (DM-8) and full §16 canonical entity tables landed (DM-2)**; data-contract tests (20); real Kaduna LGA boundary data | −2 a material share of UI-visible data is still seeded until Nigerian-priority connectors (NBS/CAC/BPP/GRID3) land; −1 quality score is steward-assigned, not auto-computed from freshness telemetry |
| (f) Observability & ops readiness | **7** | 5% | `/metrics` on all 5 deployables (executed: pytest metrics tests + gateway); Prometheus jobs per service + alerts + Grafana provisioning; **DR drill #1 executed and timed** (backup 8 s / verified restore 21 s vs 8 h RTO, 565-event chain replayed); runbooks (DR.md, NFR-EVIDENCE.md) | −1 OTel SDK env-gated and default-off — no trace ever verified end-to-end; −1 no on-call/incident process evidence; −1 7-day availability observation window pending |
| (g) Deployment automation | **7** | 10% | Compose full stack incl. ingestion+documents+keycloak; k8s base+3 overlays; Terraform root with real vpc/eks/s3 modules (GPU node group, object-lock bucket); CI with build/test/contract/e2e gates; ArgoCD manifest | −1 Terraform never applied / no plan gate in CI; −1 no deploy stage, no canary (annotations commented), ArgoCD is a single Application not ApplicationSets; −1 secrets/TLS not automated |
| (h) Scalability & performance architecture | **6** | 5% | Durable outbox + consumer registry with retry/DLQ/replay; job heartbeats + stuck-job sweeper; cursor pagination; measured **p95 reads 520 ms / advisory 614 ms at smoke scale, 0% errors** (2026-07-28, NFR-EVIDENCE.md) | −2 single-process job execution, no multi-worker coordination or horizontal-scaling evidence; −1 smoke-scale bench only — no k6 load profile executed, no 100-VU staging run; −1 no caching layer |
| (i) AI/LLM production readiness | **5** | 15% | OpenAI-compatible serving layer with tier routing, per-tier circuit breakers, SSE streaming — integration-tested vs mock OpenAI; default embedding indexer + reindex CLI + OpenSearch k-NN path; prompt-regression harness (10 golden Qs); PII redaction pre-generation; routing metrics; honest GPU note in docs/LLM.md | −3 **no model has ever been served** — no GPU, weights, vLLM deployment, or live eval; offline synthesizer is the production default; −1 hashing embeddings are recall-limited; Neo4j/OpenSearch/PostGIS all off the default path; −1 no Ray Serve, specialist-tier traces not persisted |
| (j) Documentation & operability | **9** | 5% | 26 docs: architecture, ADRs, API, data model, security, LLM, ingestion, loader, documents, geospatial, events, testing, DR + executed-drill evidence, NFR evidence with dated perf numbers, I18N, PWA evidence, compliance matrix; onboarding packs ×3 | −1 some docs describe target state (e.g. k6 thresholds) that has only been exercised via the sandbox bench |
| **Overall (weighted)** | **7.1** | 100% | 0.15·8 + 0.10·8 + 0.15·8 + 0.10·7 + 0.05·7 + 0.05·7 + 0.10·7 + 0.05·6 + 0.15·5 + 0.05·9 | |

## What the score means

**7.1/10 — "pilot-ready, spec target met; still short of full production evidence."** The engineering surface (tests, CI, security controls, auditability, DR) is genuinely strong and *verified by execution in this audit*, not just inspection. The score is held below 7 by three structural facts:

1. **The AI core is unproven in production form** — no GPU model has ever been served; the serving layer is validated only against a mock endpoint, and embeddings default to a hashing stand-in. (Dimension i = 5, weighted 15%.)
2. **The default deployment path omits the spec's heavy infrastructure** — Neo4j, OpenSearch, PostGIS, Keycloak, OTel, S3 are all implemented but env-gated off; Iceberg/Trino/Airbyte/Dagster/Ray/Cesium do not exist at all.
3. **Operational evidence is point-in-time** — one DR drill, one perf bench, zero days of the 7-day uptime window observed, and no cloud environment has ever been provisioned from the Terraform/k8s/GitOps assets.

## Fastest paths to raise the score

- Serve a small Qwen tier on the Terraform GPU pool in staging and flip `retrieval_mode`/routing metrics to `remote` (+1.0–1.5 on dimensions a, i).
- Run k6 on staging and complete the 7-day uptime window (+0.5–1.0 on f, h; closes TEST-3).
- Make Keycloak the default IdP and enable TLS + scan gates (+0.5–1.0 on d).
- Apply Terraform to a dev account in CI (`validate`/`plan` gate) and add a deploy stage (+0.5–1.0 on g).

## Final status — 2026-07-28 (final confirmation round, `master` 24e6b96)

- **Spec completion: 81.7% weighted** (63 full / 21 partial / 6 not of 90) — the ≥80% target is met. Final-round closures: DM-2, DM-8, DM-3, TEST-5, API-8, EVT-1, AI-8, each with executed test evidence (see `docs/COMPLIANCE.md`).
- **Merged-tree gate (executed by orchestrator): vitest 200/200 passed (31 files), pytest 185/185, `tsc -b` clean.**
- **Production readiness: 7.1/10** (was 6.9). Moved dimensions: (a) functionality 7→8 on the 81.7% completion + closed canonical-model/event-schema/routing-audit rows; (e) data & provenance 6→7 on the landed EvidenceSource registry metadata and full §16 entity coverage.
- **Remaining blockers to "production" (unchanged):** no LLM ever served on GPU; lakehouse/orchestration (Iceberg/Trino/Airbyte/Dagster/Ray) absent; Keycloak not the default IdP; no k6-on-staging run and the 7-day uptime window still pending; Terraform never applied.
