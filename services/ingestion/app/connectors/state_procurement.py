"""State procurement portals connector (feat-conn-subnat-firms).

Harvests contract award records from state public procurement portals —
Lagos State Public Procurement Agency, Kaduna State Public Procurement
Authority (KDPPA / e-procurement), Kano State Public Procurement Bureau —
with a generic `https://<state>state.gov.ng/procurement` fallback for other
states.

Emits: procurement_records (buyer, supplier, value, award date, status,
ocid) with the state carried in the payload for jurisdiction routing.

Live path: GET the state awards listing (per-state base URL override via
params). Offline fallback: when the source is unreachable, the connector
loads the bundled fixture `tests/fixtures/state_procurement_sample.json`
and stamps every record `origin="derived"` — the fallback is never
presented as live data.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from app.errors import ServiceError
from app.models import CanonicalRecord, RawRecord
from app.connectors.base import BaseConnector

DEFAULT_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "tests"
    / "fixtures"
    / "state_procurement_sample.json"
)

STATE_PROCUREMENT_PORTALS: dict[str, str] = {
    "lagos": os.getenv(
        "LAGOS_PROCUREMENT_URL",
        "https://ppa.lagosstate.gov.ng/awards",
    ),
    "kaduna": os.getenv(
        "KADUNA_PROCUREMENT_URL",
        "https://kdppa.kdsg.gov.ng/api/awards",
    ),
    "kano": os.getenv(
        "KANO_PROCUREMENT_URL",
        "https://procurement.kanostate.gov.ng/awards",
    ),
}

STATE_JURISDICTIONS: dict[str, str] = {
    "lagos": "ng-la",
    "kaduna": "ng-kd",
    "kano": "ng-kn",
}


def state_procurement_url(state: str) -> str:
    slug = state.strip().lower()
    if slug in STATE_PROCUREMENT_PORTALS:
        return STATE_PROCUREMENT_PORTALS[slug]
    return f"https://{slug}state.gov.ng/procurement/awards"


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text())


class StateProcurementConnector(BaseConnector):
    name = "state_procurement"
    description = (
        "State procurement portals (Lagos PPA / Kaduna KDPPA / Kano PPB, "
        "generic state fallback) — contract awards as procurement_records "
        "(fixture fallback)"
    )
    source_id = "state_procurement_portals"
    license = "State public procurement authorities (published awards)"
    max_record_age_days = 45  # monthly refresh cadence

    REQUIRED_KEYS = ("buyer", "ocid")

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        states = params.get("states") or ["lagos", "kaduna", "kano"]
        if isinstance(states, str):
            states = [states]
        limit = int(params.get("limit", 100))
        raw: list[RawRecord] = []
        for state in states:
            slug = str(state).strip().lower()
            base = (params.get("base_url")
                    or state_procurement_url(slug)).rstrip("/")
            url = params.get("awards_url") or f"{base}?limit={limit}"
            try:
                body = self.get_json(url)
                records = (
                    body if isinstance(body, list)
                    else body.get("records") or body.get("data")
                    or body.get("awards") or []
                )
                raw.append(RawRecord(
                    provenance=self.provenance(url, body),
                    payload={
                        "jurisdiction": STATE_JURISDICTIONS.get(
                            slug, jurisdiction),
                        "state": slug,
                        "listing_url": url,
                        "records": records[:limit],
                    },
                ))
            except ServiceError:
                fixture_path = Path(
                    params.get("fixture_path") or DEFAULT_FIXTURE)
                fixture = _load_fixture(fixture_path)
                records = [
                    r for r in fixture.get("records", [])
                    if str(r.get("state", "")).lower() == slug
                ] or fixture.get("records", [])
                raw.append(RawRecord(
                    provenance=self.provenance(None, fixture, origin="derived"),
                    payload={
                        "jurisdiction": STATE_JURISDICTIONS.get(
                            slug, jurisdiction),
                        "state": slug,
                        "listing_url": url,
                        "fixture": fixture_path.name,
                        "records": records,
                    },
                ))
        return raw

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for rec in raw:
            for r in rec.payload["records"]:
                buyer = r.get("buyer") or r.get("procuringEntity") or {}
                buyer_name = (
                    buyer.get("name") if isinstance(buyer, dict) else str(buyer))
                awards = r.get("awards") or (
                    [r["award"]] if r.get("award") else [{}])
                award = awards[0] if awards else {}
                suppliers = award.get("suppliers") or r.get("suppliers") or []
                supplier = (
                    suppliers[0].get("name")
                    if suppliers and isinstance(suppliers[0], dict) else None)
                value = award.get("value") or r.get("value") or {}
                amount = value.get("amount") if isinstance(value, dict) else value
                ocid = r.get("ocid") or r.get("id") or r.get("project_id")
                if not ocid:
                    continue
                out.append(CanonicalRecord(
                    entity="procurement_record",
                    provenance=rec.provenance,
                    data={
                        "ocid": str(ocid),
                        "jurisdiction_id": rec.payload.get("jurisdiction"),
                        "buyer": (buyer_name or "unknown")[:255],
                        "supplier": (supplier or "")[:255] or None,
                        "value_ngn": (
                            float(amount) if amount is not None else None),
                        "award_date": str(
                            award.get("date") or r.get("date") or ""
                        )[:32] or None,
                        "status": str(
                            r.get("status") or award.get("status")
                            or "unknown")[:32],
                        "title": (
                            r.get("title")
                            or r.get("tender", {}).get("title") or "")[:255],
                        "state": rec.payload.get("state"),
                    },
                ))
        return out
