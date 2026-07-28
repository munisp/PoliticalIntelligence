"""NBS headline indicator series connector (nigerianstat.gov.ng).

Harvests headline National Bureau of Statistics indicator series —
CPI inflation (year-on-year), real GDP growth, unemployment rate — and
emits `sector_metric` canonical records with indicator codes `NBS_*`
destined for the platform `sector_metrics` table.

Distinct from `nbs_bulletin`, which indexes the NBS *PDF bulletin portal*
and emits `data_source` metadata records only; this connector ingests
published indicator *series values*.

Live path: GET the NBS published-data endpoint
(NBS_SERIES_BASE_URL override). Offline fallback: when the source is
unreachable, the connector loads the bundled fixture
`tests/fixtures/nbs_series_sample.json` and stamps every record
`origin="derived"` — the fallback is never presented as live data.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from app.errors import ServiceError
from app.models import CanonicalRecord, RawRecord
from app.connectors.base import BaseConnector

DEFAULT_BASE = os.getenv("NBS_SERIES_BASE_URL", "https://www.nigerianstat.gov.ng")
DEFAULT_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "tests"
    / "fixtures"
    / "nbs_series_sample.json"
)

# NBS indicator codes -> canonical metric keys / sectors.
NBS_INDICATORS: dict[str, dict[str, str]] = {
    "NBS_CPI_INFLATION": {"metric_key": "cpi_inflation_yoy",
                          "sector_code": "economy"},
    "NBS_GDP_GROWTH": {"metric_key": "gdp_growth_real",
                       "sector_code": "economy"},
    "NBS_UNEMPLOYMENT": {"metric_key": "unemployment_rate",
                         "sector_code": "labor"},
}


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text())


class NbsSeriesConnector(BaseConnector):
    name = "nbs_series"
    description = (
        "NBS headline indicator series (nigerianstat.gov.ng published "
        "data) — CPI inflation, GDP growth, unemployment as NBS_* "
        "sector_metric records (fixture fallback)"
    )
    source_id = "nbs_indicator_series"
    license = "National Bureau of Statistics (published data)"
    max_record_age_days = 120  # quarterly headline releases

    REQUIRED_KEYS = ("jurisdiction_id", "sector_code", "metric_key",
                     "value", "period")

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        base = (params.get("base_url") or DEFAULT_BASE).rstrip("/")
        url = params.get("series_url") or f"{base}/api/indicators/headline"
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
                    "series_url": url,
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
                    "series_url": url,
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
                mapping = NBS_INDICATORS.get(indicator)
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
                            "confidence": 0.95,
                        },
                    ))
        return out
