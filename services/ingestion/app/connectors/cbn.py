"""Central Bank of Nigeria connector (cbn.gov.ng).

Harvests headline monetary statistics — Monetary Policy Rate (MPR),
official FX rate (NGN/USD), and credit to the private sector — and emits
`sector_metric` canonical records with indicator codes `CBN_*` destined
for the platform `sector_metrics` table.

Live path: GET the CBN statistics endpoint (CBN_BASE_URL override).
Offline fallback: when the source is unreachable, the connector loads the
bundled fixture `tests/fixtures/cbn_series_sample.json` and stamps every
record `origin="derived"` — the fallback is never presented as live data.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from app.errors import ServiceError
from app.models import CanonicalRecord, RawRecord
from app.connectors.base import BaseConnector

DEFAULT_BASE = os.getenv("CBN_BASE_URL", "https://www.cbn.gov.ng")
DEFAULT_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "tests"
    / "fixtures"
    / "cbn_series_sample.json"
)

# CBN indicator codes -> canonical metric keys / sectors.
CBN_INDICATORS: dict[str, dict[str, str]] = {
    "CBN_MPR": {"metric_key": "monetary_policy_rate", "sector_code": "economy"},
    "CBN_FX_RATE_OFFICIAL": {"metric_key": "fx_rate_ngn_usd_official",
                             "sector_code": "economy"},
    "CBN_CREDIT_PRIVATE_SECTOR": {"metric_key": "credit_to_private_sector_ngn_bn",
                                  "sector_code": "finance"},
}


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text())


class CbnConnector(BaseConnector):
    name = "cbn"
    description = (
        "Central Bank of Nigeria (cbn.gov.ng) — MPR, FX rate, credit to "
        "private sector as CBN_* sector_metric records (fixture fallback)"
    )
    source_id = "cbn_statistics"
    license = "Central Bank of Nigeria (public statistics)"
    max_record_age_days = 45  # monthly statistics cadence

    REQUIRED_KEYS = ("jurisdiction_id", "sector_code", "metric_key",
                     "value", "period")

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        base = (params.get("base_url") or DEFAULT_BASE).rstrip("/")
        url = params.get("statistics_url") or (
            f"{base}/api/statistics/monetary-credit"
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
                mapping = CBN_INDICATORS.get(indicator)
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
