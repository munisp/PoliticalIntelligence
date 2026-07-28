"""Debt Management Office connector (dmo.gov.ng).

Harvests public debt statistics — total public debt, domestic/external
split, and debt service — and emits `sector_metric` canonical records
with indicator codes `DMO_*` destined for the platform `sector_metrics`
table.

Live path: GET the DMO debt statistics endpoint (DMO_BASE_URL override).
Offline fallback: when the source is unreachable, the connector loads the
bundled fixture `tests/fixtures/dmo_debt_sample.json` and stamps every
record `origin="derived"` — the fallback is never presented as live data.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from app.errors import ServiceError
from app.models import CanonicalRecord, RawRecord
from app.connectors.base import BaseConnector

DEFAULT_BASE = os.getenv("DMO_BASE_URL", "https://www.dmo.gov.ng")
DEFAULT_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "tests"
    / "fixtures"
    / "dmo_debt_sample.json"
)

# DMO indicator codes -> canonical metric keys / sectors.
DMO_INDICATORS: dict[str, dict[str, str]] = {
    "DMO_TOTAL_PUBLIC_DEBT": {"metric_key": "total_public_debt_ngn_bn",
                              "sector_code": "finance"},
    "DMO_DOMESTIC_DEBT": {"metric_key": "domestic_debt_ngn_bn",
                          "sector_code": "finance"},
    "DMO_EXTERNAL_DEBT": {"metric_key": "external_debt_usd_mn",
                          "sector_code": "finance"},
    "DMO_DEBT_SERVICE": {"metric_key": "debt_service_ngn_bn",
                         "sector_code": "finance"},
}


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text())


class DmoConnector(BaseConnector):
    name = "dmo"
    description = (
        "Debt Management Office (dmo.gov.ng) — total public debt, "
        "domestic/external split, debt service as DMO_* sector_metric "
        "records (fixture fallback)"
    )
    source_id = "dmo_debt_statistics"
    license = "Debt Management Office Nigeria (public statistics)"
    max_record_age_days = 120  # quarterly debt statistics cadence

    REQUIRED_KEYS = ("jurisdiction_id", "sector_code", "metric_key",
                     "value", "period")

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        base = (params.get("base_url") or DEFAULT_BASE).rstrip("/")
        url = params.get("statistics_url") or (
            f"{base}/api/debt-statistics/public-debt"
        )
        try:
            body = self.get_json(url)
            series = (
                body.get("series") or body.get("records") or body.get("data")
                if isinstance(body, dict) else body
            ) or []
            return [RawRecord(
                provenance=self.provenance(url, body),
                payload={
                    "jurisdiction": jurisdiction,
                    "statistics_url": url,
                    "series": series,
                },
            )]
        except ServiceError:
            fixture_path = Path(params.get("fixture_path") or DEFAULT_FIXTURE)
            fixture = _load_fixture(fixture_path)
            return [RawRecord(
                provenance=self.provenance(
                    None, fixture, origin="derived",
                ),
                payload={
                    "jurisdiction": jurisdiction,
                    "statistics_url": url,
                    "fixture": fixture_path.name,
                    "series": fixture.get("series", []),
                },
            )]

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for rec in raw:
            jurisdiction = rec.payload.get("jurisdiction")
            for series in rec.payload["series"]:
                indicator = str(series.get("indicator") or "").strip()
                mapping = DMO_INDICATORS.get(indicator)
                if mapping is None:
                    continue
                for point in series.get("points", []):
                    value = point.get("value")
                    period = str(point.get("period") or "").strip()
                    if value is None or not period:
                        continue
                    out.append(CanonicalRecord(
                        entity="sector_metric",
                        provenance=rec.provenance,
                        data={
                            "jurisdiction_id": jurisdiction,
                            "sector_code": mapping["sector_code"],
                            "metric_key": mapping["metric_key"],
                            "indicator_id": indicator,
                            "value": float(value),
                            "period": period,
                            "confidence": 0.9,
                        },
                    ))
        return out
