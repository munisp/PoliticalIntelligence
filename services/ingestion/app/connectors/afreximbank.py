"""Afreximbank project/trade finance announcements connector
(feat-conn-subnat-firms).

Harvests African Export-Import Bank project and trade finance
announcements touching Nigeria — facility amount, beneficiary, sector,
instrument — and emits budget_line records with
`tier="development_partner"` -> `budgets` table.

Live path: GET the Afreximbank announcements endpoint
(AFREXIM_BASE_URL override). Offline fallback: when the source is
unreachable, the connector loads the bundled fixture
`tests/fixtures/afreximbank_announcements_sample.json` and stamps every
record `origin="derived"` — the fallback is never presented as live data.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from app.errors import ServiceError
from app.models import CanonicalRecord, RawRecord
from app.connectors.base import BaseConnector

DEFAULT_BASE = os.getenv(
    "AFREXIM_BASE_URL", "https://www.afreximbank.com")
DEFAULT_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "tests"
    / "fixtures"
    / "afreximbank_announcements_sample.json"
)

STATE_JURISDICTIONS: dict[str, str] = {
    "lagos": "ng-la",
    "kaduna": "ng-kd",
    "kano": "ng-kn",
}


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text())


class AfreximbankConnector(BaseConnector):
    name = "afreximbank"
    description = (
        "Afreximbank project/trade finance announcements — facilities as "
        "budget_line records (tier=development_partner; fixture fallback)"
    )
    source_id = "afreximbank_announcements"
    license = "Afreximbank (public announcements)"
    max_record_age_days = 45  # monthly refresh cadence

    REQUIRED_KEYS = ("budget_id", "mda", "fiscal_year", "tier")

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        base = (params.get("base_url") or DEFAULT_BASE).rstrip("/")
        url = params.get("announcements_url") or (
            f"{base}/api/announcements?country=Nigeria")
        try:
            body = self.get_json(url)
            rows = (
                body.get("announcements") or body.get("rows")
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
                facility_id = (row.get("facility_id") or "").strip()
                title = (row.get("title") or "").strip()
                if not facility_id or not title:
                    continue
                amount_ngn = row.get("amount_ngn")
                if amount_ngn is None and row.get("amount_usd") is not None:
                    rate = float(
                        row.get("exchange_rate_ngn_per_usd") or 1500.0)
                    amount_ngn = float(row["amount_usd"]) * rate
                state = str(row.get("state") or "").strip()
                row_jurisdiction = STATE_JURISDICTIONS.get(
                    state.lower(), jurisdiction)
                year = int(row.get("announcement_year") or 0)
                sector = (row.get("sector") or "trade")[:32]
                out.append(CanonicalRecord(
                    entity="budget_line",
                    provenance=rec.provenance,
                    data={
                        "budget_id": f"afreximbank:{facility_id}"[:96],
                        "jurisdiction_id": row_jurisdiction,
                        "mda": (
                            row.get("beneficiary")
                            or "Afreximbank facility")[:255],
                        "program_code": facility_id[:64],
                        "description": title[:512],
                        "sector_code": sector,
                        "amount_ngn": (
                            float(amount_ngn) if amount_ngn is not None else None),
                        "fiscal_year": year,
                        "appropriation_type": "capital",
                        "tier": "development_partner",
                        "partner": "Afreximbank",
                        "instrument": row.get("instrument") or "loan",
                        "state": state or None,
                    },
                ))
        return out
