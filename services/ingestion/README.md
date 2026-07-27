# Ingestion Service

Live data-source connector layer for the Meridian Policy Twin. Fetches real
data from verified public endpoints, normalizes to canonical entities, and
labels every record with provenance (`live` / `derived` / `seed` + source
URL, fetch timestamp, SHA-256 checksum, license).

See `docs/INGESTION.md` for the sourcing model and connector dev guide.

## Connectors

| Name | Source | Status |
|---|---|---|
| `worldbank` | World Bank API (any ISO3 country × indicators) | LIVE (NGA + KEN verified) |
| `hdx` | HDX CKAN API (boundaries, health facilities, GRID3) | LIVE |
| `overpass` | OSM Overpass (mirror + retry) — POI facilities by admin area | LIVE endpoint |
| `nada` | NBS microdata catalog (IHSN NADA) — survey metadata | LIVE (metadata) |
| `budeshi` | Budeshi OCDS procurement records | LIVE endpoint (fixture-validated) |
| `file_harvester` | Scheduled XLSX/CSV/PDF download + checksum (stdlib parsing, no pandas) | DOWNLOAD class |

## API

- `POST /v1/ingest/{connector}` — `{jurisdiction, since?, params?}` → 202 + job
  (`Idempotency-Key` header honored)
- `GET /v1/ingest/jobs/{job_id}` — status, record counts, contract results
- `GET /v1/connectors` — connector status, last fetch, cumulative counts
- `GET /health`

All responses use the standard `{data, meta, audit}` envelope; errors use
the structured error envelope.

## Pipeline

`fetch → contract_check → normalize → dedupe → emit`

- Artifacts: `./artifacts/ingestion/<connector>/<YYYY-MM-DD>.jsonl`
- Events: `ingest.raw.received`, `features.materialized` via producer
  adapter — Kafka/Redpanda when `KAFKA_BROKERS` is set and `kafka-python`
  is installed (`pip install -r requirements-extras.txt`), else noop stdout.

## Run

```bash
pip install -r requirements.txt
uvicorn app.main:app --port 8300
# or
docker build -t meridian-ingestion . && docker run -p 8300:8300 meridian-ingestion
```

## Test

```bash
python -m pytest   # 26 tests; recorded fixtures only, no network
```

Example (live):

```bash
curl -X POST localhost:8300/v1/ingest/worldbank \
  -H 'content-type: application/json' \
  -d '{"jurisdiction":"ken","params":{"country_iso3":"KEN"}}'
```
