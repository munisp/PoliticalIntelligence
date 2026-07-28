# NFR Evidence Pack

Status of evidence for every non-functional requirement in the NFR table of
`docs/TESTING.md`. **Evidence-ready** means a runnable artifact exists today;
**evidence-pending** means the mechanism exists but the NFR cannot be honestly
claimed met (noted per row). Nothing below is claimed without a pointer.

| NFR | Target | Evidence | Status |
| --- | ------ | -------- | ------ |
| Availability | 99.5% uptime (monthly) | SLI alert rules `infra/monitoring/alerts.yml` (group `platform-slo`), Grafana dashboards `infra/monitoring/grafana/dashboards`, Prometheus scrape config `infra/monitoring/prometheus.yml`, gateway-emitted series `api/utils/metrics.ts` (`http_request_duration_seconds`, `jobs_total`, …) exposed at `GET /metrics` | **evidence-pending** — instrumentation + alerts exist; a 99.5% monthly SLI needs a production observation window (no uptime history yet) |
| Read latency | p95 < 5s for dashboard reads | `tests/k6/api-reads.k6.js` (100 VU/5m, threshold `p(95)<5000`), sandbox equivalent `tests/perf/local-bench.mjs` (same thresholds, CI `e2e` job runs `--smoke`), alert `DashboardReadLatencyHigh` in `infra/monitoring/alerts.yml` | **evidence-ready** |
| Advisory/generation latency | p95 < 20s | `tests/k6/advisory.k6.js` (20 VU/5m, threshold `p(95)<20000`), advisory group in `tests/perf/local-bench.mjs`, `llm_routing_decisions_total` series | **evidence-ready** (intake + status round trip; full LLM completion latency is pending a served model tier — offline synthesizer is the default) |
| Concurrency | 100 read / 20 LLM concurrent sessions | k6 executors above (constant-vus 100 / 20); `tests/perf/local-bench.mjs` worker counts (`READ_VUS`/`ADVISORY_VUS`) | **evidence-ready** |
| DR | RPO ≤ 24h, RTO ≤ 8h | `scripts/backup.sh` (mysqldump + artifacts tar + audit WORM export + sha256 manifest + retention; zero-binary fallback `scripts/tidb-dump.mjs`), `scripts/restore.sh` (verified restore into scratch DB: manifest check, row-count assertions, audit chain replay), runbook `docs/DR.md` incl. quarterly timed drill checklist, **DR drill #1 executed 2026-07-28** (see "Executed DR drills" below) | **evidence-ready** — first timed drill: full DB + audit restore in ≈29 s vs 8 h RTO |
| Audit retention | 7 years, immutable | Hash-chained audit log `api/utils/auditchain.ts` + `auditLog.verify` endpoint (asserted in `tests/e2e/e2e.mjs`), WORM export inside every backup (`audit-worm-export.sql.gz` + manifest, verified in `scripts/restore.sh`) | **evidence-pending** — tamper-evidence + export verification exist; immutability depends on enabling object-lock on the upload bucket (ops step documented in `docs/DR.md`) |
| Reproducibility | Same inputs + seed ⇒ identical outputs | `services/simulation/tests/test_reproducibility.py` (reproducibility hash), seeded `reproducibility_hash` run manifests in `db/seed.ts` | **evidence-ready** (pytest suite green; calibration/backtesting still open per `docs/COMPLIANCE.md`) |
| Explainability | Citations on every recommendation; reasoning traces stored | Contract-level `evidence_base ≥ 1` (`contracts/entities.ts`), brief citations rail (`api/runner.ts`, ≥3 sources, tested in `api/tests/briefs-citations.test.ts`), golden Q&A citation checks `services/ai/tests/test_regression.py`, e2e assertion "generated brief has non-empty citations" in `tests/e2e/e2e.mjs` | **evidence-ready** |
| Localization | Jurisdiction/sector packs configurable without code changes | i18n packs `src/i18n/{en,ha,ig,yo}.ts`, onboarding packs `onboarding/packs/{kaduna-ng,lagos-ng,nairobi-ke}` + `pack.schema.json`, config-driven onboarding API `api/onboarding.ts` | **evidence-ready** (packs + loader exist; full UI string externalization tracked in `docs/COMPLIANCE.md`) |

## How to reproduce each evidence artifact

```bash
# Latency + concurrency (k6)
k6 run tests/k6/api-reads.k6.js
SESSION_COOKIE=$(node tests/e2e/mint-session.mjs --union-id e2e-analyst) k6 run tests/k6/advisory.k6.js

# Latency + concurrency (zero-dep, runs anywhere Node 20 does)
node tests/perf/local-bench.mjs --smoke          # 30s CI profile
node tests/perf/local-bench.mjs                  # full 5m NFR profile

# E2E golden flows (envelope, idempotency, lifecycle, RBAC, audit, metrics)
npx tsx db/seed.ts && npx tsx tests/e2e/seed-users.ts
BASE_URL=http://localhost:3000 node tests/e2e/e2e.mjs

# Backup + verified restore (DR drill core)
DATABASE_URL=mysql://… scripts/backup.sh
DATABASE_URL=mysql://… scripts/restore.sh backups/<timestamp>

# Audit chain replay (also covered by the e2e suite)
# → tRPC auditLog.verify as an executive/platform_admin user

# Reproducibility + explainability + regression suites
cd services/simulation && pytest tests/test_reproducibility.py
cd ../ai && pytest

# Monitoring
docker compose -f infra/docker/docker-compose.yml up prometheus grafana
```

## CI wiring

`.github/workflows/ci.yml` runs, on every PR and push to `main`:

- `node-tests` — `npm ci`, `npm run check`, `npm run test` (vitest incl.
  contract/ABAC/audit-chain tests).
- `python-tests` — pytest for `services/simulation`, `services/ai`,
  `services/ingestion` (matrix; `services/documents` does not exist yet).
- `e2e` — MySQL 8 service, `db:push` → seed → seed-users → build → start →
  `tests/e2e/e2e.mjs` → `tests/perf/local-bench.mjs --smoke`.
- `security` — `npm audit --omit=dev --audit-level=high` + gitleaks.
- `release-gate` — main only; requires every job green and echoes the
  remaining pre-release evidence checklist from `docs/TESTING.md`.

## Observation windows (availability + recorded runs)

**Availability measurement method.** The availability SLI (99.5% monthly) is
measured with the Prometheus blackbox prober, not self-reported uptime:

- `infra/monitoring/blackbox.yml` + the `blackbox-exporter` compose service
  probe `GET /healthz` (app, simulation, ai) and `GET /health` (ingestion,
  documents) every 15s via the `blackbox-health` job in
  `infra/monitoring/prometheus.yml`.
- Alert `UptimeProbeFailing` (`infra/monitoring/alerts.yml`, group
  `platform-uptime`) fires when `probe_success == 0` for 5m on any target.
- Monthly SLI per target: `avg_over_time(probe_success[30d])`; the platform
  SLI is the minimum across targets. A 7-day observation window
  (`avg_over_time(probe_success[7d])`) is the pre-production gate.

**First-window checklist (7-day, staging):**

1. `docker compose -f infra/docker/docker-compose.yml up -d` (full stack incl.
   `blackbox-exporter`, `prometheus`).
2. Verify `probe_success` = 1 for all 5 targets in Prometheus (`/graph`).
3. Record window start; leave the stack undisturbed except planned chaos
   (one deliberate `docker stop app` to validate the alert fires ≤5m).
4. At day 7, export `avg_over_time(probe_success[7d])` per target and attach
   the Prometheus export to the release evidence bundle.
5. File the result below under "Executed windows".

**Executed windows:**

| Window | Environment | Targets | Result | Evidence |
| --- | --- | --- | --- | --- |
| _pending_ | staging | 5 health endpoints | — | first run of the checklist above |

**Executed DR drills:**

### DR drill #1 — 2026-07-28 (TEST-3, executed)

Environment: sandbox MySQL-compatible cluster (TiDB endpoint); no
`mysqldump`/`mysql` binaries available, so both scripts exercised the
zero-binary fallback `scripts/tidb-dump.mjs` (automatic fallback path in
`scripts/backup.sh` / `scripts/restore.sh`).

| Step | Result | Time |
| --- | --- | --- |
| `scripts/backup.sh` | rc=0 — 565 audit events exported, all 41 tables dumped (30+ core tables), `manifest.sha256` written, TiDB fallback engaged | 8 s |
| `scripts/restore.sh backups/20260728-010957` into scratch DB `…_restore_check` | rc=0 — manifest verified, 139 statements loaded, row counts verified: jurisdictions 6, admin_units 63, sector_metrics 194, opportunities 11, users 9, audit_events 565 | 21 s |
| Audit chain replay against scratch DB | `chain_valid: true` — 557 chained events + 8 legacy events, no broken links | (incl. above) |
| **RTO evidence** | **≈29 s total for full DB + audit restore vs 8 h NFR target** | — |

Scratch DB dropped after verification (`DROP DATABASE …_restore_check`).
Drill scope note: RPO ≤ 24 h is a scheduling property (daily cron per
`docs/DR.md`); this drill evidences the RTO leg.

**Executed performance runs:**

| Date | Method | Profile | p95 reads | p95 advisory | Error rate | Requests | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-07-27 | `node tests/perf/local-bench.mjs` (zero-dep bench, same thresholds as `tests/k6/*.k6.js`) against the built server on the seeded MySQL pilot | NFR smoke | **360 ms** | **610 ms** | **0%** | 340 reads + 71 advisory | ✅ within NFR (p95 < 5s / 20s) |
| 2026-07-28 | `BASE_URL=http://localhost:3100 SESSION_COOKIE=$(node tests/e2e/mint-session.mjs --union-id e2e-analyst) node tests/perf/local-bench.mjs --smoke` against the freshly built server (`npm run build && PORT=3100 npm start`) on the sandbox DB | NFR smoke | **520 ms** (p50 91 ms, p99 532 ms) | **614 ms** (p50 583 ms, p99 624 ms) | **0%** | 322 reads + 68 advisory | ✅ PASS — within NFR (p95 < 5s / 20s) |

Method note: the bench drives the real HTTP surface (`/v1/jurisdictions`,
`/v1/opportunities/rankings`, brief/advisory intake + status polling) with
concurrent workers; p95 is computed client-side over completed requests.
The k6 profiles (`tests/k6/api-reads.k6.js`, `tests/k6/advisory.k6.js`) run
the same thresholds on staging for the full 5-minute windows.
