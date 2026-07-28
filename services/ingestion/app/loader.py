"""Ingestion -> platform DB loader (docs/LOADER.md).

POSTs canonical records to the platform API loader endpoint
(`jurisdictions.loadCanonical`, tRPC + superjson) in batches of 500,
authenticated with the shared `x-loader-key` header.

Discipline:
  - errors are RECORDED, never raised — a loader outage must not fail an
    otherwise successful ingestion run (the JSONL artifact + events are
    already durable);
  - per-entity inserted/updated/error counts are aggregated across batches
    and returned as the loader outcome (surfaced on the
    features.materialized event, the job payload, and ingestion_runs via
    the onboarding flow).

Env:
  PLATFORM_API_URL   default http://localhost:3000
  LOADER_API_KEY     shared secret; when unset the loader is disabled and
                     reports {status: "skipped"}.
  LOADER_BATCH_SIZE  default 500
"""
from __future__ import annotations

import json
import os
import urllib.request
from typing import Any

from app.logging_setup import get_logger
from app.models import CanonicalRecord

log = get_logger("loader")

BATCH_SIZE = int(os.getenv("LOADER_BATCH_SIZE", "500"))

ENTITY_KEYS = {
    "sector_metric": "sector_metrics",
    "facility": "facilities",
    "procurement_record": "procurement_records",
    "data_source": "data_sources",
    # G2: realized outcome observations -> outcomes.upsertObservations
    # (docs/OUTCOMES.md). Routed to a dedicated tRPC procedure (see
    # _PROCEDURE below) because the outcome store keys observations by
    # series id rather than by the canonical-batch natural keys.
    "outcome_observation": "observations",
    # feat-ng-connectors: Budget Office appropriation lines -> budgets;
    # NASS bills -> policy_documents (document_type="bill").
    "budget_line": "budgets",
    "bill_document": "policy_documents",
}

# Entity batch key -> tRPC loader procedure.
_PROCEDURE = {
    "observations": "outcomes.upsertObservations",
}


def _platform_url(procedure: str = "jurisdictions.loadCanonical") -> str:
    base = os.getenv("PLATFORM_API_URL", "http://localhost:3000").rstrip("/")
    return f"{base}/api/trpc/{procedure}"


def _api_key() -> str:
    return os.getenv("LOADER_API_KEY", "")


def _post_batch(batch: dict[str, Any], jurisdiction: str) -> dict[str, Any]:
    """POST one batch (tRPC+superjson wire shape); returns counts dict."""
    key = next(iter(batch))
    procedure = _PROCEDURE.get(key, "jurisdictions.loadCanonical")
    body = json.dumps({"json": {"jurisdiction_id": jurisdiction, **batch}}).encode()
    req = urllib.request.Request(
        _platform_url(procedure),
        data=body,
        headers={
            "content-type": "application/json",
            "x-loader-key": _api_key(),
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        payload = json.loads(resp.read())
    if "error" in payload:
        raise RuntimeError(f"loader API error: {payload['error']}")
    result = payload["result"]["data"]
    data = result.get("json", result)
    # Standard envelope: {data: {records, counts}, meta, audit}
    inner = data.get("data", data)
    return inner.get("counts", inner)


def load_canonical(
    records: list[CanonicalRecord], jurisdiction: str
) -> dict[str, Any]:
    """Load canonical records into the platform DB; returns the outcome."""
    entities: dict[str, list[dict]] = {v: [] for v in ENTITY_KEYS.values()}
    skipped = 0
    for rec in records:
        key = ENTITY_KEYS.get(rec.entity)
        if key is None:
            skipped += 1
            continue
        data = dict(rec.data)
        # Connector output may carry a source-system id (e.g. ISO3 "NGA");
        # the platform natural key is the run's jurisdiction id.
        if "jurisdiction_id" in data:
            data["jurisdiction_id"] = jurisdiction
        entities[key].append(
            {
                "data": data,
                "provenance": {
                    "origin": rec.provenance.origin,
                    "source_id": rec.provenance.source_id,
                    "url": rec.provenance.url,
                    "fetched_at": rec.provenance.fetched_at.isoformat(),
                },
            }
        )

    outcome: dict[str, Any] = {
        "status": "ok",
        "endpoint": _platform_url(),
        "batches": 0,
        "skipped_entities": skipped,
        "entities": {
            k: {"records": len(v), "inserted": 0, "updated": 0, "errors": 0}
            for k, v in entities.items()
            if v
        },
        "error_messages": [],
    }

    if not _api_key():
        outcome["status"] = "skipped"
        outcome["reason"] = "LOADER_API_KEY not configured"
        log.warning("loader disabled: LOADER_API_KEY not set")
        return outcome

    for key, rows in entities.items():
        if not rows:
            continue
        for i in range(0, len(rows), BATCH_SIZE):
            batch = {key: rows[i : i + BATCH_SIZE]}
            outcome["batches"] += 1
            try:
                counts = _post_batch(batch, jurisdiction)
                ent = outcome["entities"][key]
                ent["inserted"] += counts.get(key, {}).get("inserted", 0)
                ent["updated"] += counts.get(key, {}).get("updated", 0)
                ent["errors"] += counts.get(key, {}).get("errors", 0)
                for msg in counts.get("error_messages", []):
                    outcome["error_messages"].append(msg)
            except Exception as exc:  # recorded, not raised
                outcome["entities"][key]["errors"] += len(batch[key])
                outcome["error_messages"].append(f"batch {key}[{i}]: {exc}")
                outcome["status"] = "partial"
                log.error("loader batch failed: %s", exc)

    if outcome["error_messages"] and outcome["status"] == "ok":
        outcome["status"] = "partial"
    return outcome
