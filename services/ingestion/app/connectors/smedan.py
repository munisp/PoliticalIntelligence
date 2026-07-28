"""SMEDAN MSME survey highlights connector (feat-conn-subnat-firms).

Harvests headline indicators from the Small and Medium Enterprises
Development Agency of Nigeria (SMEDAN) / NBS MSME survey — MSME counts,
employment contribution, and sector/state breakdowns — as sector_metric
records with `SMEDAN_`-prefixed metric keys.

Emits: sector_metrics (SMEDAN_MSME_COUNT, SMEDAN_MSME_EMPLOYMENT,
SMEDAN_MSME_GDP_SHARE_PCT, SMEDAN_INFORMAL_SHARE_PCT, ...).

Live path: GET the SMEDAN survey highlights endpoint
(SMEDAN_BASE_URL override). Offline fallback: when the source is
unreachable, the connector loads the bundled fixture
`tests/fixtures/smedan_survey_sample.json` and stamps every record
`origin="derived"` — the fallback is never presented as live data.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from app.errors import ServiceError
from app.models import CanonicalRecord, RawRecord
from app.connectors.base import BaseConnector

DEFAULT_BASE = os.getenv("SMEDAN_BASE_URL", "https://smedan.gov.ng")
DEFAULT_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "tests"
    / "fixtures"
    / "smedan_survey_sample.json"
)

# fixture/live keys -> canonical metric keys
METRIC_KEYS = {
    "msme_count": "SMEDAN_MSME_COUNT",
    "msme_employment": "SMEDAN_MSME_EMPLOYMENT",
    "msme_gdp_share_pct": "SMEDAN_MSME_GDP_SHARE_PCT",
    "informal_share_pct": "SMEDAN_INFORMAL_SHARE_PCT",
    "women_owned_share_pct": "SMEDAN_WOMEN_OWNED_SHARE_PCT",
}

SECTOR_BY_SCOPE = {
    "national": "economy",
    "state": "economy",
}


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text())


class SmedanConnector(BaseConnector):
    name = "smedan"
    description = (
        "SMEDAN/NBS MSME survey highlights — MSME counts, employment, GDP "
        "share as SMEDAN_* sector_metrics (fixture fallback)"
    )
    source_id = "smedan_msme_survey"
    license = "SMEDAN/NBS MSME survey (published highlights)"
    max_record_age_days = 370  # survey cadence is multi-annual

    REQUIRED_KEYS = ("metric_key", "value", "period")

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        base = (params.get("base_url") or DEFAULT_BASE).rstrip("/")
        url = params.get("survey_url") or (
            f"{base}/msme-survey/highlights")
        try:
            body = self.get_json(url)
            rows = (
                body.get("highlights") or body.get("rows")
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
            return [RawRecord(
                provenance=self.provenance(None, fixture, origin="derived"),
                payload={
                    "jurisdiction": jurisdiction,
                    "listing_url": url,
                    "fixture": fixture_path.name,
                    "rows": fixture.get("rows", []),
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
                row_jurisdiction = (
                    row.get("jurisdiction_id") or jurisdiction)
                sector = SECTOR_BY_SCOPE.get(
                    str(row.get("scope") or "national"), "economy")
                for src_key, metric_key in METRIC_KEYS.items():
                    value = row.get(src_key)
                    if value is None:
                        continue
                    out.append(CanonicalRecord(
                        entity="sector_metric",
                        provenance=rec.provenance,
                        data={
                            "jurisdiction_id": row_jurisdiction,
                            "sector_code": sector,
                            "metric_key": metric_key,
                            "value": float(value),
                            "period": period[:16],
                            "confidence": 0.8,
                            "source_id": self.source_id,
                            "state": row.get("state"),
                        },
                    ))
        return out
