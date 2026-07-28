"""Ingestion pipeline: fetch -> validate -> normalize -> dedupe -> emit.

Outputs:
  - canonical JSONL at <artifacts_dir>/<connector>/<YYYY-MM-DD>.jsonl
  - platform events (ingest.raw.received, features.materialized) via the
    configured producer (Kafka/Redpanda or noop stdout).

Deterministic where applicable: dedupe keys and artifact layout are stable
for identical inputs.
"""
from __future__ import annotations

import json
from pathlib import Path

from app import events, loader
from app.config import settings
from app.connectors.base import BaseConnector
from app.models import CanonicalRecord, ContractResult, utcnow


def _dedupe_key(rec: CanonicalRecord) -> str:
    d = rec.data
    parts = [rec.entity]
    for k in ("jurisdiction_id", "sector_code", "metric_key", "period",
              "ocid", "source", "name", "source_id"):
        if d.get(k) is not None:
            parts.append(f"{k}={d[k]}")
    return "|".join(parts)


def dedupe(records: list[CanonicalRecord]) -> list[CanonicalRecord]:
    seen: set[str] = set()
    out: list[CanonicalRecord] = []
    for rec in records:
        key = _dedupe_key(rec)
        if key in seen:
            continue
        seen.add(key)
        out.append(rec)
    return out


def run_pipeline(
    connector: BaseConnector,
    jurisdiction: str,
    since: str | None = None,
    params: dict | None = None,
    producer=None,
    artifacts_dir: str | None = None,
) -> dict:
    """Execute one ingestion run; returns a run summary dict."""
    producer = producer or events.build_producer()
    params = params or {}

    raw = connector.fetch(jurisdiction, since, params)
    producer.send(events.TOPIC_INGEST_RAW, {
        "connector": connector.name,
        "jurisdiction": jurisdiction,
        "records_in": len(raw),
        "fetched_at": utcnow().isoformat(),
    })

    normalized = connector.normalize(raw)
    contract = connector.contract_check(raw, normalized)
    canonical = dedupe(normalized)

    out_dir = Path(artifacts_dir or settings.artifacts_dir) / connector.name
    out_dir.mkdir(parents=True, exist_ok=True)
    artifact = out_dir / f"{utcnow():%Y-%m-%d}.jsonl"
    with artifact.open("a", encoding="utf-8") as fh:
        for rec in canonical:
            fh.write(rec.model_dump_json() + "\n")

    # Post-emit: load canonical records into the platform DB. Loader errors
    # are recorded (never raised) so a loader outage cannot fail the run.
    loader_outcome = loader.load_canonical(canonical, jurisdiction)

    producer.send(events.TOPIC_FEATURES_MATERIALIZED, {
        "connector": connector.name,
        "jurisdiction": jurisdiction,
        "records_out": len(canonical),
        "artifact": str(artifact),
        "contract": contract.model_dump(mode="json"),
        "loader": loader_outcome,
    })

    try:
        from app.metrics import counter
        counter("ingestion_records_total",
                "Canonical records ingested").inc(
                    {"connector": connector.name}, amount=len(canonical))
        counter("ingestion_runs_total", "Ingestion runs").inc(
            {"connector": connector.name,
             "status": "succeeded" if contract.schema_ok else "contract_failed"})
    except Exception:
        pass
    return {
        "connector": connector.name,
        "jurisdiction": jurisdiction,
        "records_in": len(raw),
        "records_out": len(canonical),
        "artifact": str(artifact),
        "contract": contract,
        "loader": loader_outcome,
    }
