# Ingestion → DB Loader

> **Integration note (one line):** the loader endpoint
> `jurisdictions.loadCanonical` rides on the already-mounted
> `jurisdictions` router — no `api/router.ts` change required.

This document describes how canonical records produced by the ingestion
service land in the platform database, end to end.

## 1. Flow

```
connector.fetch -> normalize -> dedupe -> JSONL artifact
                                      -> events: ingest.raw.received
                                      -> loader.load_canonical()   (NEW)
                                      -> events: features.materialized (+loader outcome)
                                      -> job payload (+loader)     (NEW)
                                      -> ingestion_runs            (via onboarding poll)
```

`services/ingestion/app/loader.py` POSTs canonical records to the platform
API in **batches of 500** (`LOADER_BATCH_SIZE`), grouped by entity
(`sector_metrics`, `facilities`, `procurement_records`, `data_sources`).

| Env (ingestion service) | Default | Purpose |
|---|---|---|
| `PLATFORM_API_URL` | `http://localhost:3000` | Platform API base |
| `LOADER_API_KEY` | — (unset = loader skipped) | Shared secret, sent as `x-loader-key` header |
| `LOADER_BATCH_SIZE` | `500` | Records per entity per HTTP call |

The wire protocol is tRPC + superjson
(`POST {PLATFORM_API_URL}/api/trpc/jurisdictions.loadCanonical`,
body `{"json": {...}}`).

## 2. API endpoint

`jurisdictions.loadCanonical` (mutation, `api/jurisdictions.ts`):

- **Auth:** machine-to-machine via the `x-loader-key` header, compared
  against `LOADER_API_KEY` in the app environment. Missing/mismatched key
  (or unset env) → `401 LOADER_KEY_INVALID`.
- **Validation:** zod-validated batches — up to 500 records per entity
  array per call; each record is `{data, provenance{origin, source_id,
  url, fetched_at}}`.
- **Audit:** one `loader.canonical.batch` audit event per accepted batch.
- **Response:** per-entity `{inserted, updated, errors}` counts plus
  `error_messages`. Per-record errors are **recorded, never raised**.

## 3. Natural-key upserts (`api/queries/canonical.ts`)

TiDB does not report MySQL `affectedRows` update semantics reliably, so
upserts are **select-then-write**:

| Entity | Natural key |
|---|---|
| `sector_metrics` | jurisdiction_id + metric_key + period + source_id |
| `facilities` | facility_id (fallback: source locator) |
| `procurement_records` | ocid (fallback: record_id) |
| `data_sources` | source_id (PK) |

On key collision only the mutable payload (value/confidence/name/…) is
updated — **origin / source_url / fetched_at are preserved**, so a live
row is never silently downgraded and replays are idempotent (a second
identical run produces updates, not duplicates).

## 4. Jurisdiction id mapping

Connector output may carry a source-system id (World Bank emits ISO3,
e.g. `NGA`). The loader rewrites `data.jurisdiction_id` to the run's
jurisdiction (e.g. `ng-kd`) before posting. The read path
(`latestMetricsPreferringLive`) reads across both the pack id (`ng-kd`)
and the seed id (`jur:ng-kd`), preferring **live > derived > seed** per
metric key, so freshly loaded live rows immediately surface on the
jurisdiction profile with unchanged response shape.

## 5. Outcome surfaces

- `features.materialized` event payload gains a `loader` object.
- The ingestion job payload (`GET /v1/ingest/jobs/{id}`) gains `loader`.
- `onboarding.onboard` polls every accepted ingestion job to a terminal
  state, persists final status/records/loader counts into
  `ingestion_runs.contract_results.loader`, and returns
  `{loader_counts, provenance}` (post-load live/derived/seed counts).

## 6. Verified live (rebuilt workstream re-verification)

Against the real TiDB (`.env`), running the `kaduna-ng` pack's World Bank
connector through the loader:

- ~150 live `sector_metrics` rows (6 indicators × 25 years), `origin=live`,
  `source_url` on `api.worldbank.org`, `source_id=worldbank_api`;
- a second identical run produces **updates, not duplicates**;
- the endpoint returns **401** without a valid `x-loader-key`.

## 7. Tests

`services/ingestion/tests/test_loader.py` — 7 tests (mocked platform API):
wire shape + loader key, jurisdiction override, 500-record batching,
entity grouping, disabled-without-key, error recording (not raising),
replay-reports-updates. Suite total: 33 pytest green.

## 7. Realized outcomes (G2)

`outcome_observation` records (produced by the `nbs_outcomes` connector)
are routed by the loader to a dedicated endpoint instead of
`jurisdictions.loadCanonical`: `outcomes.upsertObservations`
(`POST {PLATFORM_API_URL}/api/trpc/outcomes.upsertObservations`), with the
same `x-loader-key` auth, 500-record batch cap, per-entity
`{inserted, updated, errors}` counts, and record-never-raise error
discipline. See docs/OUTCOMES.md for the store schema, the sim-service
handoff (`POST /v1/outcomes`), and the causal/backtest consumption paths.
