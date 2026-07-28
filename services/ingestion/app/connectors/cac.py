"""Corporate Affairs Commission (CAC) connector (feat-conn-subnat-firms).

Harvests new business registration records by sector and state from the
CAC public search/statistics endpoints (publicsearch.cac.gov.ng).
NOTE: at build time the CAC portal returned HTTP 403 to non-browser
clients and its search is captcha/session-gated (see docs/INGESTION.md
"not machine-readable" table), so the connector is written against the
documented public-search record shape, attempts the live endpoint, and
falls back to a bundled fixture stamped `origin="derived"`.

Emits: business_registration records (name, RC number, entity type,
registration date, state/LGA, sector) -> `business_registrations` table.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from app.errors import ServiceError
from app.models import CanonicalRecord, RawRecord
from app.connectors.base import BaseConnector

DEFAULT_BASE = os.getenv(
    "CAC_BASE_URL", "https://publicsearch.cac.gov.ng/api")
DEFAULT_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "tests"
    / "fixtures"
    / "cac_registrations_sample.json"
)

STATE_JURISDICTIONS: dict[str, str] = {
    "lagos": "ng-la",
    "kaduna": "ng-kd",
    "kano": "ng-kn",
    "abuja": "ng-fc",
    "fct": "ng-fc",
    "rivers": "ng-ri",
}

VALID_ENTITY_TYPES = (
    "limited_liability", "business_name", "incorporated_trustees",
    "limited_partnership", "llp",
)


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text())


class CacConnector(BaseConnector):
    name = "cac"
    description = (
        "Corporate Affairs Commission — new business registrations by "
        "sector/state as business_registration records (fixture fallback)"
    )
    source_id = "cac_public_search"
    license = "Corporate Affairs Commission (public registry data)"
    max_record_age_days = 45  # monthly refresh cadence

    REQUIRED_KEYS = ("registration_id", "name", "registered_at")

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        base = (params.get("base_url") or DEFAULT_BASE).rstrip("/")
        state = params.get("state")
        limit = int(params.get("limit", 100))
        url = f"{base}/registrations?limit={limit}" + (
            f"&state={state}" if state else "")
        try:
            body = self.get_json(url)
            records = (
                body if isinstance(body, list)
                else body.get("registrations") or body.get("records")
                or body.get("data") or []
            )
            return [RawRecord(
                provenance=self.provenance(url, body),
                payload={
                    "jurisdiction": jurisdiction,
                    "listing_url": url,
                    "records": records[:limit],
                },
            )]
        except ServiceError:
            fixture_path = Path(params.get("fixture_path") or DEFAULT_FIXTURE)
            fixture = _load_fixture(fixture_path)
            records = fixture.get("records", [])
            if state:
                records = [
                    r for r in records
                    if str(r.get("state", "")).lower()
                    == str(state).lower()
                ]
            return [RawRecord(
                provenance=self.provenance(None, fixture, origin="derived"),
                payload={
                    "jurisdiction": jurisdiction,
                    "listing_url": url,
                    "fixture": fixture_path.name,
                    "records": records,
                },
            )]

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for rec in raw:
            jurisdiction = rec.payload.get("jurisdiction")
            for r in rec.payload["records"]:
                name = (r.get("name") or "").strip()
                rc_number = (r.get("rc_number") or "").strip() or None
                registered_at = str(r.get("registered_at") or "")[:32]
                if not name or not registered_at:
                    continue
                entity_type = str(r.get("entity_type") or "").lower()
                if entity_type not in VALID_ENTITY_TYPES:
                    entity_type = "limited_liability"
                state = str(r.get("state") or "").strip()
                record_jurisdiction = STATE_JURISDICTIONS.get(
                    state.lower(), jurisdiction)
                registration_id = r.get("registration_id") or (
                    f"{self.source_id}:{rc_number or name[:32]}"
                )
                out.append(CanonicalRecord(
                    entity="business_registration",
                    provenance=rec.provenance,
                    data={
                        "registration_id": str(registration_id)[:96],
                        "jurisdiction_id": record_jurisdiction,
                        "name": name[:255],
                        "rc_number": rc_number[:32] if rc_number else None,
                        "entity_type": entity_type,
                        "registered_at": registered_at,
                        "status": str(r.get("status") or "active")[:32],
                        "lga": (r.get("lga") or "")[:128] or None,
                        "state": state or None,
                        "sector": (r.get("sector") or "general")[:64],
                    },
                ))
        return out
