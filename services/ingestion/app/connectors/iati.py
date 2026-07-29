"""IATI aid-flow activity data connector (feat-conn-subnat-firms).

Harvests International Aid Transparency Initiative (IATI) activity data
for Nigeria from the IATI Datastore API — reporting organisation, sector
(DAC codes), commitments/disbursements, locations — and emits budget_line
records with `tier="development_partner"` -> `budgets` table.

Live path: GET the IATI Datastore activity query
(`https://api.iatistandard.org/datastore/activity/select`,
IATI_BASE_URL override). The datastore sits behind Azure API Management
and requires a (free) subscription key from the IATI developer portal;
supply it via the IATI_API_KEY env var or `params["api_key"]` — it is
sent as the `Ocp-Apim-Subscription-Key` header. Without a key the API
answers HTTP 401, which is treated as a fetch failure and falls through
to the offline fallback: the connector loads the bundled fixture
`tests/fixtures/iati_activities_sample.json` and stamps every record
`origin="derived"` — the fallback is never presented as live data.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from app.errors import ServiceError
from app.models import CanonicalRecord, RawRecord
from app.connectors.base import BaseConnector

DEFAULT_BASE = os.getenv(
    "IATI_BASE_URL", "https://api.iatistandard.org/datastore")
# Azure APIM subscription key for the IATI Datastore (free from the IATI
# developer portal). Optional: absent → 401 → fixture fallback (derived).
API_KEY = os.getenv("IATI_API_KEY")
DEFAULT_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "tests"
    / "fixtures"
    / "iati_activities_sample.json"
)

STATE_JURISDICTIONS: dict[str, str] = {
    "lagos": "ng-la",
    "kaduna": "ng-kd",
    "kano": "ng-kn",
}


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text())


class IatiConnector(BaseConnector):
    name = "iati"
    description = (
        "IATI Datastore aid-flow activities (Nigeria) — commitments as "
        "budget_line records (tier=development_partner; fixture fallback)"
    )
    source_id = "iati_datastore"
    license = "IATI (publisher data, CC-BY per publisher registry)"
    max_record_age_days = 45  # monthly refresh cadence

    REQUIRED_KEYS = ("budget_id", "mda", "fiscal_year", "tier")

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        base = (params.get("base_url") or DEFAULT_BASE).rstrip("/")
        limit = int(params.get("limit", 100))
        url = params.get("activities_url") or (
            f"{base}/activity/select?q=recipient_country_code:NG"
            f"&rows={limit}")
        api_key = params.get("api_key") or API_KEY
        headers = (
            {"Ocp-Apim-Subscription-Key": api_key} if api_key else {})
        try:
            body = self.get_json(url, headers=headers)
            if isinstance(body, dict):
                docs = (
                    (body.get("response") or {}).get("docs")
                    or body.get("docs") or body.get("activities")
                    or body.get("records") or [])
            else:
                docs = body
            return [RawRecord(
                provenance=self.provenance(url, body),
                payload={
                    "jurisdiction": jurisdiction,
                    "listing_url": url,
                    "docs": docs[:limit],
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
                    "docs": fixture.get("docs", []),
                },
            )]

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for rec in raw:
            jurisdiction = rec.payload.get("jurisdiction")
            for doc in rec.payload["docs"]:
                iati_id = (doc.get("iati_identifier") or "").strip()
                title = (doc.get("title") or "").strip()
                if not iati_id or not title:
                    continue
                amount_ngn = doc.get("commitment_ngn")
                if amount_ngn is None and doc.get("commitment_usd") is not None:
                    rate = float(
                        doc.get("exchange_rate_ngn_per_usd") or 1500.0)
                    amount_ngn = float(doc["commitment_usd"]) * rate
                state = str(doc.get("state") or "").strip()
                row_jurisdiction = STATE_JURISDICTIONS.get(
                    state.lower(), jurisdiction)
                year = int(doc.get("start_year") or 0)
                sector = (doc.get("sector_code") or "general")[:32]
                org = (doc.get("reporting_org") or "IATI publisher")
                out.append(CanonicalRecord(
                    entity="budget_line",
                    provenance=rec.provenance,
                    data={
                        "budget_id": f"iati:{iati_id}"[:96],
                        "jurisdiction_id": row_jurisdiction,
                        "mda": str(org)[:255],
                        "program_code": iati_id[:64],
                        "description": title[:512],
                        "sector_code": sector,
                        "amount_ngn": (
                            float(amount_ngn) if amount_ngn is not None else None),
                        "fiscal_year": year,
                        "appropriation_type": "capital",
                        "tier": "development_partner",
                        "partner": str(org)[:255],
                        "activity_status": doc.get("activity_status"),
                        "state": state or None,
                    },
                ))
        return out
