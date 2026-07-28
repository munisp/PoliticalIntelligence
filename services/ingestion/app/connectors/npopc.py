"""NPopC demographic projections connector (feat-conn-subnat-firms).

Harvests National Population Commission demographic projections — state
and LGA population estimates/projections, growth rates, and age-structure
headlines — as sector_metric records with `POP_`-prefixed metric keys.

Emits: sector_metrics (POP_TOTAL, POP_GROWTH_RATE_PCT, POP_UNDER15_PCT,
POP_DENSITY_PER_KM2, ...).

Live path: GET the NPopC projections endpoint (NPOPC_BASE_URL override).
Offline fallback: when the source is unreachable, the connector loads the
bundled fixture `tests/fixtures/npopc_projections_sample.json` and stamps
every record `origin="derived"` — the fallback is never presented as live
data.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from app.errors import ServiceError
from app.models import CanonicalRecord, RawRecord
from app.connectors.base import BaseConnector

DEFAULT_BASE = os.getenv(
    "NPOPC_BASE_URL", "https://nationalpopulation.gov.ng")
DEFAULT_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "tests"
    / "fixtures"
    / "npopc_projections_sample.json"
)

METRIC_KEYS = {
    "population": "POP_TOTAL",
    "growth_rate_pct": "POP_GROWTH_RATE_PCT",
    "under15_pct": "POP_UNDER15_PCT",
    "working_age_pct": "POP_WORKING_AGE_PCT",
    "density_per_km2": "POP_DENSITY_PER_KM2",
}


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text())


class NpopcConnector(BaseConnector):
    name = "npopc"
    description = (
        "NPopC demographic projections by state/LGA — POP_* sector_metrics "
        "(fixture fallback)"
    )
    source_id = "npopc_projections"
    license = "National Population Commission (published projections)"
    max_record_age_days = 370  # projection vintages are multi-annual

    REQUIRED_KEYS = ("metric_key", "value", "period")

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        base = (params.get("base_url") or DEFAULT_BASE).rstrip("/")
        state = params.get("state")
        url = params.get("projections_url") or (
            f"{base}/projections/state-lga"
            + (f"?state={state}" if state else ""))
        try:
            body = self.get_json(url)
            rows = (
                body.get("rows") or body.get("projections")
                or body.get("records") or body.get("data")
                if isinstance(body, dict) else body
            ) or []
            return [RawRecord(
                provenance=self.provenance(url, body),
                payload={
                    "jurisdiction": jurisdiction,
                    "listing_url": url,
                    "rows": rows,
                },
            )]
        except ServiceError:
            fixture_path = Path(params.get("fixture_path") or DEFAULT_FIXTURE)
            fixture = _load_fixture(fixture_path)
            rows = fixture.get("rows", [])
            if state:
                rows = [
                    r for r in rows
                    if str(r.get("state", "")).lower() == str(state).lower()]
            return [RawRecord(
                provenance=self.provenance(None, fixture, origin="derived"),
                payload={
                    "jurisdiction": jurisdiction,
                    "listing_url": url,
                    "fixture": fixture_path.name,
                    "rows": rows,
                },
            )]

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for rec in raw:
            jurisdiction = rec.payload.get("jurisdiction")
            for row in rec.payload["rows"]:
                period = str(row.get("period") or "").strip()
                if not period:
                    continue
                row_jurisdiction = row.get("jurisdiction_id") or jurisdiction
                for src_key, metric_key in METRIC_KEYS.items():
                    value = row.get(src_key)
                    if value is None:
                        continue
                    out.append(CanonicalRecord(
                        entity="sector_metric",
                        provenance=rec.provenance,
                        data={
                            "jurisdiction_id": row_jurisdiction,
                            "sector_code": "demography",
                            "metric_key": metric_key,
                            "value": float(value),
                            "period": period[:16],
                            "confidence": 0.7,  # projections, not census counts
                            "source_id": self.source_id,
                            "state": row.get("state"),
                            "lga": row.get("lga"),
                        },
                    ))
        return out
