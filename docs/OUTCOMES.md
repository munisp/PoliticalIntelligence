# Realized Outcomes (G2)

The realized-outcome store closes the loop between what the platform
*simulates* and what actually *happened*: realized indicator observations
(e.g. NBS labour-force releases) feed real-data causal estimation and
engine backtesting. Both consumers fall back to their pre-G2 synthetic /
seeded behavior when no realized data is present, and every artifact
records which mode it used.

## 1. Schema (`db/schema.ts`)

- `outcome_series` — one row per (jurisdiction_id, indicator_code, source,
  frequency). Columns: `origin` enum(live|derived|seed), `unit`,
  `frequency` enum(monthly|quarterly|annual), timestamps.
  `jurisdictionId` follows the repo-wide `varchar(64)` natural-key
  convention (like every other jurisdiction-scoped table).
- `outcome_observations` — `series_id` (bigint unsigned → outcome_series
  serial id), `period` varchar(7) `YYYY-MM` (quarterly/annual series use
  the period END month), `value` double, `fetched_at`, `provenance_json`.
  Unique index on `(series_id, period)` so replays are idempotent.

## 2. Ingestion (`services/ingestion`)

- Connector `nbs_outcomes` (`app/connectors/nbs_outcomes.py`): fetches the
  NBS Nigeria labour-force extract, normalizes to `outcome_observation`
  canonical records. Deterministic; offline fixture fallback
  (`tests/fixtures/nbs_labour_force.json`) is provenance-stamped
  `origin="derived"`. Registered in the connector registry with a
  90-day refresh cadence.
- Loader (`app/loader.py`): `outcome_observation` records are posted to
  the `outcomes.upsertObservations` tRPC procedure (other entities keep
  going to `jurisdictions.loadCanonical`); same `x-loader-key` auth,
  errors recorded never raised.

## 3. Platform API (`api/outcomes.ts`)

- `outcomes.listSeries({ jurisdiction_id })` — read scope enforced.
- `outcomes.getObservations({ series_id, from?, to? })` — period window.
- `outcomes.upsertObservations({ jurisdiction_id?, observations[] })` —
  loader endpoint, `x-loader-key` protected (same pattern as
  `jurisdictions.loadCanonical`). Upserts are select-then-write keyed
  (series natural key, period); per-record errors reported, never raised.

## 4. Simulation service handoff (`services/simulation`)

Least-coupled design: the sim service **never reads the platform DB**.
Realized observations are *pushed* to it and held in a process-local
`OutcomeStore` (`app/outcomes.py`) — a handoff cache, not a system of
record:

- `POST /v1/outcomes` — loader push (`{jurisdiction_id, indicator_code,
  observations: [{period, value}]}`); honored `OUTCOMES_LOADER_KEY` env
  var via the `x-loader-key` header when set.
- `GET /v1/outcomes/{jurisdiction_id}?indicator=` — read back pushed
  series (`data_available: false` + empty lists when nothing pushed).
- **Causal engine** (`engines/causal.py`): `EngineContext.panel` accepts a
  realized panel — unit records (`treated`/`outcome`/covariates) or
  aggregated observations (`period`/`indicator`/`value`, post-median
  treatment split with trend covariate). Same OLS + placebo refutation
  path either way; `metadata.data_mode` is `"realized"` or `"synthetic"`.
  The worker attaches the pushed panel automatically for causal runs.
- **Backtest** (`backtest.py`): actuals resolution order — explicit
  `BacktestRequest.actuals` → pushed `OutcomeStore` series for the metric
  (employment→EMPLOYMENT_TOTAL, unemployment_rate→UNEMPLOYMENT_RATE,
  firm_count→FIRM_COUNT) → seeded deterministic series. The chosen source
  is recorded as `actuals_source` (`"realized"`/`"seeded"`) in the
  CalibrationReport and participates in the report hash.

Determinism is preserved in all fallback paths: synthetic-panel draws and
seeded series are unchanged; realized paths are pure functions of the
pushed observations plus the run seed.
