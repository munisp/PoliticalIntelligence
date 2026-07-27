# Data Sourcing & Jurisdiction Onboarding

> **Integration note (one line):** mount `onboardingRouter` from
> `api/onboarding.ts` as `onboarding: onboardingRouter` in `api/router.ts`
> (that file is owned by another workstream).

This document answers the core question honestly: **where does the data come
from, and how does the platform work for jurisdictions beyond Kaduna?**

## 1. Provenance model

Every record in the platform carries a provenance label, end-to-end:

| `origin` | Meaning |
|---|---|
| `live` | Fetched from a real external source by a connector (URL + fetch timestamp + SHA-256 checksum recorded) |
| `derived` | Parsed/computed from fetched artifacts (e.g. rows extracted from a downloaded XLSX bulletin) |
| `seed` | Demo/config data with no live source — **the default**, always visible, never hidden |

Schema: `origin`, `source_url`, `fetched_at` columns exist on
`jurisdictions`, `admin_units`, `sector_metrics`, `opportunities`,
`evidence_sources`, and on the new `facilities` and `procurement_records`
tables. Read APIs surface them additively (`provenance: {origin,
source_url, fetched_at}` on jurisdiction-profile metrics and opportunity
rankings). `onboarding.jurisdictions` returns per-jurisdiction
live/derived/seed counts. `ingestion_runs` audits every connector execution
including failures.

## 2. What is LIVE today (verified endpoints — docs/DATA_SOURCES_REAL.md)

| Connector | Source | Status | Emits |
|---|---|---|---|
| `worldbank` | World Bank API `api.worldbank.org/v2` | **LIVE** — verified for NGA **and KEN** from this repo (population NGA 2023 = 227,882,945; KEN 2023 = 55,339,003). Works for **any ISO3 country** — the generality proof | `sector_metrics` |
| `hdx` | HDX CKAN `data.humdata.org/api/3` | **LIVE** — package_search verified (482 Nigeria datasets); CSV resources parsed to facilities with lat/lon | `facilities`, `data_sources` |
| `nada` | NBS microdata catalog (IHSN NADA) | **LIVE for metadata** — 107 surveys; microdata files are registration-gated | `data_sources` (catalog) |
| `overpass` | OSM Overpass (mirror `overpass.kumi.systems`, retry to `overpass-api.de`) | **LIVE endpoint** (verified in DATA_SOURCES_REAL.md §10; sandbox egress blocked re-capture at build time — connector validated against structurally exact fixtures) | `facilities` (schools/clinics/hospitals/markets) |
| `budeshi` | Budeshi OCDS procurement API | **LIVE endpoint** per §6 (budeshi.ng HTTP 200); API host (`budeshi-engine.vercel.app`, discovered from the SPA bundle) was egress-blocked from the dev sandbox at build time — connector written against the OCDS release shape, fixture-validated | `procurement_records` |
| `file_harvester` | Budget Office / Open Treasury downloads | **DOWNLOAD class** — scheduled fetch + checksum; stdlib XLSX/CSV parsing (no pandas) | `data_sources`, derived rows |

Live-captured payloads are committed under
`onboarding/packs/kaduna-ng/live_samples/` and
`onboarding/packs/nairobi-ke/live_samples/`.

## 3. What is NOT machine-readable today (and exactly why)

| Source | Status | Reason |
|---|---|---|
| NBS main site (nigerianstat.gov.ng) | PORTAL-MANUAL | Publications are PDF/HTML pages; no public statistics API (catalog metadata is live via NADA) |
| UBEC factsheets | UNREACHABLE/PORTAL-MANUAL | Site connection failed at probe time; static PDF/image factsheets, no API |
| Budget Office / Open Treasury | DOWNLOAD | PDF/XLSX/CSV files only, no query API; Open Treasury was down at probe time — harvester treats per-file failures as non-fatal |
| CAC | NONE | HTTP 403 to non-browser clients; search is captcha/session-gated, no bulk/API |
| BPP / NOCOPO | PORTAL-MANUAL | Award notices as PDFs/portal pages; Budeshi OCDS is the machine-readable route |
| NELEX / NERC stats | PORTAL-MANUAL | NELEX down at probe time; NERC publishes PDF quarterly reports |
| Kenya opendata.go.ke | DEFUNCT | Portal unreliable for years; use World Bank + HDX for Kenya |
| Laws of the Federation / NASS | PORTAL-MANUAL | PDF Acts, no API/AKN feed reachable |

Where no live source exists (e.g. **state-granular economic series** for
Kaduna/Lagos — NBS publishes those only as PDFs), the pack's `seed_policy`
declares the allowed fallback and the records are labeled `origin=seed`.
Nothing is silently presented as live.

## 4. How onboarding a new jurisdiction works

1. Author `onboarding/packs/<code>/pack.yaml` (declarative; schema:
   `onboarding/packs/pack.schema.json`; guide: `onboarding/packs/README.md`
   — under 30 minutes, no code changes).
2. `onboarding.onboard {pack_code}` (protected: `data_steward` /
   `platform_admin`; idempotent via `idempotency_key`) creates a job that:
   - upserts the jurisdiction, admin units, and sectors from the pack
     (labeled `seed` — config-declared structure);
   - calls the ingestion service (`INGESTION_BASE_URL`, default
     `http://localhost:8300`) `POST /v1/ingest/{connector}` for each
     configured connector with the pack's connector config;
   - if the service is unreachable, falls back to a deterministic local run
     and records the failure in `ingestion_runs` (auditable, not silent).
3. `onboarding.status(jobId)` polls the job; `onboarding.jurisdictions`
   shows provenance counts per jurisdiction.

Proof packs: `kaduna-ng` (pilot), `lagos-ng` (second Nigerian state, same
pipeline), `nairobi-ke` (Kenya — different country, currency KES, languages
en/sw, county/sub-county hierarchy — same pipeline, zero code changes).

## 5. Ingestion service (`services/ingestion/`)

FastAPI, same engineering standards as `services/simulation` (envelope,
structured errors, async jobs with idempotency, pytest, Dockerfile).

- `POST /v1/ingest/{connector}` — body `{jurisdiction, since?, params?}`,
  `Idempotency-Key` header honored; returns 202 + job handle.
- `GET /v1/ingest/jobs/{job_id}` — job status, record counts, contract results.
- `GET /v1/connectors` — connector registry with last-run status and counts.
- `GET /health`.

Pipeline: `fetch → contract_check → normalize → dedupe → emit`.
Canonical JSONL artifacts at `./artifacts/ingestion/<source>/<date>.jsonl`
(one JSON object per line: entity + data + provenance). Platform events
`ingest.raw.received` and `features.materialized` are emitted via a
producer adapter: Redpanda/Kafka when `KAFKA_BROKERS` is set and
`kafka-python` installed (`requirements-extras.txt`), otherwise a noop
stdout adapter (default, fully functional offline).

Run: `pip install -r requirements.txt && uvicorn app.main:app --port 8300`.
Tests (no network — recorded fixtures): `python -m pytest` (26 tests).

## 6. Connector developer guide

A connector is a class in `services/ingestion/app/connectors/` implementing:

```python
class MyConnector(BaseConnector):
    name = "my_source"; source_id = "my_source"; license = "..."
    def fetch(self, jurisdiction, since, params) -> list[RawRecord]: ...
    def normalize(self, raw) -> list[CanonicalRecord]: ...
```

- `fetch` returns raw payloads wrapped with `self.provenance(url, payload)`
  (adds source_id, URL, fetched_at, SHA-256 checksum, license).
- `normalize` maps to canonical entities: `jurisdiction`, `admin_unit`,
  `sector_metric`, `facility`, `procurement_record`, `data_source`.
- `contract_check` (inherited) validates required keys (`REQUIRED_KEYS`),
  freshness (`max_record_age_days`), and completeness; results travel with
  the job and are persisted to `ingestion_runs.contract_results`.
- Register in `app/connectors/__init__.py` `REGISTRY`; add a fixture +
  tests (fixtures must be small real captures; tests never hit the network).
