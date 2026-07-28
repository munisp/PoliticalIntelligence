# Testing & Validation Strategy

## Test layers

| Layer | Scope | Tooling | Gate |
| ----- | ----- | ------- | ---- |
| Unit | Pure functions, routers, domain logic in app + both Python services | Vitest (TS), pytest (Python) | Every PR (CI) |
| Integration | API ↔ MySQL/Redis-like stores, service ↔ service, ingest pipeline slices | pytest + testcontainers / compose | Every PR |
| Contract | `contracts/` schemas: API payloads + event schemas; provider/consumer verification | Schema checks in CI; Pact-style verification for service boundaries | Every PR; blocks merge on schema drift |
| E2E API | Golden flows: login → profile → opportunity generation job → scenario → brief | Playwright/Supertest against staging compose | Nightly + pre-release |
| dbt data contracts | Analytical models: uniqueness, not-null, accepted values, freshness per source | dbt tests | Every pipeline run; failed contract blocks dataset promotion |
| Model eval + prompt regression | Golden task suites per tier (answer quality, citation correctness, refusal behavior); retrieval recall@k | Eval harness in `services/ai` | Pre-merge for prompt/model/routing changes; nightly full suite |
| Simulation calibration & reproducibility | Backtests against historical outcomes; same inputs + seed ⇒ identical outputs (`reproducibility_hash`) | pytest suites in `services/simulation` | Pre-release; calibration report attached to release |
| Security | Dependency scan, container scan, CodeQL, authz policy tests (role × jurisdiction matrix) | CI + scheduled | Every PR (scans); policy matrix pre-release |
| Performance | Load tests against NFR table below | k6 | Pre-release on staging |
| UAT | Stakeholder scenarios per `NIGERIA_PILOT.md` user panel | Scripted UAT sessions | Go/no-go gates at month 6 and each rollout wave |

## Non-functional requirements (NFRs)

| NFR | Target | Verified by |
| --- | ------ | ----------- |
| Availability | 99.5% uptime (monthly) | SLI on Platform Overview dashboard; error budget policy |
| Read latency | p95 < 5s for dashboard reads | k6 + `DashboardReadLatencyHigh` alert |
| Advisory/generation latency | p95 < 20s for advisory (copilot/advisory responses) | k6 + model routing metrics |
| Concurrency | 100 concurrent read sessions; 20 concurrent LLM sessions | k6 load profiles |
| DR | RPO ≤ 24h, RTO ≤ 8h | Quarterly restore drill, timed |
| Audit retention | 7 years, immutable | WORM export verification in DR drill |
| Reproducibility | Simulation runs and generations re-runnable from manifest (inputs, seed, model/data versions) | Reproducibility test suite |
| Explainability | Every generated recommendation carries citations to `EvidenceSource`s; specialist-tier reasoning traces stored | Eval harness citation checks |
| Localization | Jurisdiction hierarchy and sector packs configurable per deployment without code changes | Config-driven deployment test in CI |

## Practical commands

```bash
# Node: typecheck + unit tests
npm run check
npm test

# Python services
cd services/simulation && pytest
cd ../ai && pytest

# Full local stack for integration/E2E
docker compose -f infra/docker/docker-compose.yml up --build
```

## Release quality gates

1. All CI jobs green (node, python ×2, docker ×3, CodeQL).
2. dbt data contracts pass on staging data.
3. Model eval + prompt regression within agreed deltas of the baseline; no citation-correctness regression.
4. Simulation calibration report attached; reproducibility suite green.
5. Performance run meets NFR table; security scans clean or triaged.
6. Staging canary healthy for the bake window before prod promotion.

## Implementation status (added with the NFR evidence pack)

As of the `feat-nfr-ci` branch the following layers now have runnable
artifacts; see `docs/NFR-EVIDENCE.md` for the per-NFR mapping and commands:

- **Performance**: k6 profiles in `tests/k6/` (api-reads 100 VU p95<5s,
  advisory 20 VU p95<20s, 30s CI smoke) plus the zero-dependency
  `tests/perf/local-bench.mjs` that enforces the same NFR thresholds and runs
  in the CI `e2e` job.
- **E2E API**: zero-dependency runner `tests/e2e/e2e.mjs` covering health,
  envelope shape, idempotency, scenario lifecycle with uncertainty bands,
  brief RBAC matrix, audit-chain verify, and required `/metrics` series.
- **DR**: `scripts/backup.sh` / `scripts/restore.sh` + `docs/DR.md` runbook;
  the RPO/RTO claims become *verified* after the first timed quarterly drill.
- **CI**: `node-tests`, `python-tests` (simulation/ai/ingestion), `e2e`,
  `security`, and a main-branch `release-gate` job in `.github/workflows/ci.yml`.

Still pending (honest gaps): full 5-minute k6 runs against staging, the first
timed DR drill, object-lock enforcement on the backup bucket, and a production
uptime window for the availability SLI.

## Backtesting & calibration (SIM-5)

Engine-level backtesting lives in `services/simulation/app/backtest.py` and is
exercised by `services/simulation/tests/test_backtest.py` (18 tests) plus the
API-surface tests in `api/tests/backtest-calibration.test.ts` (5 tests).

* **Walk-forward validation.** Every engine is evaluated over multiple
  expanding cutoff windows (default grid derived from history length, ≥3
  windows, ≥3 held-out months each). At each cutoff the engine is hindcast
  using only pre-cutoff data — the forecast engine genuinely refits its Holt
  state-space model on the truncated window — and scored against the realized
  post-cutoff segment. Tests assert no train/test leakage per window.
* **Calibration metrics.** Per window and aggregated per engine: MAPE, RMSE,
  `coverage_80` (share of realized points inside the engine's 80% uncertainty
  band) and `skill_vs_naive` (1 − RMSE/RMSE_naive, naive = persistence of the
  last training value). Metric functions are unit-tested on synthetic arrays
  with known values (exact MAPE/RMSE/coverage/skill expectations).
* **Reproducibility.** All stochastic components derive from `random_seed`
  via SHA-256 stable hashing; each report carries a content `report_hash`.
  Determinism tests assert identical reports/hashes across repeated runs and
  differing hashes across seeds/jurisdictions.
* **Artifacts & recalibration.** `persist_report` writes
  `backtests/{jurisdiction_id}/{metric}-calibration-{hash}.json`;
  `recalibrate_from_backtest` maps per-engine residual bias onto twin
  behavioral priors (hiring elasticity, subsidy take-up, firm birth rate),
  clamps them, persists a new twin-state version, and records the event in
  the twin's adaptive layer. Tests verify direction, bounds, and persistence.
* **Endpoints.** `POST /v1/backtests` (simulation service) and the tRPC
  `innovations.calibrationReport` query (`api/bridges/backtest.ts`) expose
  the walk-forward windows and per-engine calibration table in the standard
  envelope.

```bash
cd services/simulation && pytest tests/test_backtest.py
npx vitest run api/tests/backtest-calibration.test.ts
```
