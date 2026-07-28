# Airbyte declarative sources (ING-8)

Low-code CDK manifests for the 8 ingestion sources, mirroring the custom
connectors in `services/ingestion/app/connectors/`. Use Airbyte when an ops
team wants UI-managed syncs; the built-in connectors + Dagster schedules
(`app/orchestration/dagster_defs.py`) remain the code-managed path.

| Manifest | Source | Cadence (Dagster schedule) |
|----------|--------|----------------------------|
| `source-worldbank.yaml` | World Bank indicators API | daily |
| `source-hdx.yaml` | HDX CKAN package_search | daily |
| `source-overpass.yaml` | OSM Overpass facilities | weekly |
| `source-budeshi.yaml` | Budeshi OCDS procurement releases | daily |
| `source-nada.yaml` | NBS NADA microdata catalog | weekly |
| `source-nbs_bulletin.yaml` | NBS bulletin index | weekly |
| `source-ubec.yaml` | UBEC fact-sheet index | weekly |
| `source-file_harvester.yaml` | Local file drop zone | hourly |

## Run Airbyte locally

Use the official compose stack (not duplicated in the platform compose —
it is a separate, optional control plane):

```bash
git clone --depth 1 https://github.com/airbytehq/airbyte.git /tmp/airbyte
cd /tmp/airbyte && ./run-ab-platform.sh
# UI on http://localhost:8000 (default creds airbyte/password)
```

## Import a declarative source

1. Airbyte UI → **Builder** → **Import YAML** → paste one `source-*.yaml`.
2. Publish the connector, then create a **Source** from it (config values
   are the `spec.connection_specification` properties).
3. Destination: point at the platform loader webhook
   (`POST $PLATFORM_API_URL/v1/loader/canonical` with header
   `x-loader-key: $LOADER_API_KEY`, docs/LOADER.md) via a webhook
   destination, or land raw JSON in MinIO (`s3://policy-twin/raw/`) for the
   file harvester to pick up — the Dagster `new_data_source_sensor` will
   fire on new objects.

Manifests are schema-checked in CI by
`services/ingestion/tests/test_airbyte_manifests.py`.
