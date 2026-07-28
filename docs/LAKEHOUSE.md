# Lakehouse (DM-4, ADR-005) + Trino analytical fabric (DM-5, ADR-006)

Canonical entities are exported from the operational MySQL store to an
**Apache Iceberg** lakehouse on MinIO/S3 (or a local warehouse dir) and
queried analytically through **Trino**.

## Export pipeline

`services/ingestion/app/lakehouse/` — PyIceberg-based, incremental:

```bash
cd services/ingestion
pip install -r requirements.txt -r requirements-extras.txt  # pyiceberg extra

# full export of one entity (first run is always full)
python -m app.lakehouse export --entity sector_metrics --full

# incremental (watermark = max(updated_at), persisted per entity)
python -m app.lakehouse export --entity sector_metrics

# dev/CI without MySQL: canonical JSONL input (loader shape, docs/LOADER.md)
python -m app.lakehouse export --entity sector_metrics --source-jsonl metrics.jsonl

# plan only — no writes, no state changes
python -m app.lakehouse export --entity sector_metrics --dry-run
```

Exported tables (namespace `policy_twin`, partitioned layouts):
`jurisdictions (country_code, admin_level)`, `sector_metrics (sector_code)`,
`opportunities (sector_code)`, `laws (category)`, `clauses (clause_type)`,
`simulation_runs (engine)`, `evidence_sources`, `budgets (fiscal_year)`,
`facilities (facility_type)`, `procurement_records (buyer)`.

Configuration (env):

| Var | Default | Purpose |
|-----|---------|---------|
| `LAKEHOUSE_WAREHOUSE` | `s3://policy-twin/lakehouse` | warehouse root (`file://…` for local) |
| `S3_ENDPOINT` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` | MinIO compose values | S3-compatible storage |
| `LAKEHOUSE_CATALOG` | `sql` | `sql` (sqlite dev catalog) or `rest` (Nessie/Tabular; needs `LAKEHOUSE_REST_URI`) |
| `LAKEHOUSE_STATE_FILE` | `<artifacts>/lakehouse-state.json` | per-entity watermarks |

**Sandbox honesty:** the sandbox has no Docker and no pyiceberg install, so
unit tests mock the table writer and assert planning/record-mapping/watermark
behavior; a real PyIceberg round-trip test exists and is skipped unless the
`pyiceberg` extra is installed. Without pyiceberg the exporter falls back to
a partitioned JSONL preview writer (loudly logged) so the pipeline is still
fully exercisable.

## Trino

`infra/docker/docker-compose.yml` service `trino` (trinodb/trino, port 8080)
mounts `infra/docker/trino/catalog/iceberg.properties` (hadoop catalog on the
MinIO warehouse — no Hive metastore needed for dev; switch to
`iceberg.catalog.type=rest` for a shared catalog in staging/prod).

### Smoke query

```bash
docker compose -f infra/docker/docker-compose.yml up trino
docker exec -it $(docker ps -qf name=trino) trino
```

```sql
SHOW TABLES FROM iceberg.policy_twin;
SELECT sector_code, count(*), avg(value)
FROM iceberg.policy_twin.sector_metrics
GROUP BY sector_code ORDER BY 2 DESC;
SELECT jurisdiction_id, fiscal_year, sum(amount)
FROM iceberg.policy_twin.budgets
GROUP BY 1, 2 ORDER BY 3 DESC;
```

(A `SHOW TABLES` after the first export proves the end-to-end path:
MySQL → export → Iceberg/MinIO → Trino.)
