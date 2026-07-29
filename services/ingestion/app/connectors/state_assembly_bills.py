"""State Houses of Assembly bills connector (feat-conn-subnat-firms).

Harvests bills metadata — title, sponsor, chamber, legislative stage, date,
thematic sector, source document URL — from state Houses of Assembly
publications. Lagos, Kaduna, and Kano assemblies are first-class; other
states use a generic `https://<state>state.gov.ng/house-of-assembly`
pattern. States are unicameral (single House of Assembly); `chamber` is
carried for schema parity with the federal tracker.

Emits: bill_document records routed to the platform `policy_documents`
table (`document_type="bill"`; state, chamber, stage carried in metadata).

Live path: GET the state assembly bills listing (per-state base URL
override via params). Offline fallback: when the source is unreachable, the
connector loads the bundled fixture
`tests/fixtures/state_assembly_bills_sample.json` and stamps every record
`origin="derived"` — the fallback is never presented as live data.
"""
from __future__ import annotations

import hashlib
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
    / "state_assembly_bills_sample.json"
)

STATE_ASSEMBLY_PORTALS: dict[str, str] = {
    "lagos": os.getenv(
        "LAGOS_ASSEMBLY_URL",
        "https://lagoshouseofassembly.gov.ng/bills",
    ),
    "kaduna": os.getenv(
        "KADUNA_ASSEMBLY_URL",
        "https://kdsha.kdsg.gov.ng/bills",
    ),
    "kano": os.getenv(
        "KANO_ASSEMBLY_URL",
        "https://kanosha.gov.ng/bills",
    ),
}

STATE_JURISDICTIONS: dict[str, str] = {
    "lagos": "ng-la",
    "kaduna": "ng-kd",
    "kano": "ng-kn",
}

VALID_STAGES = (
    "first_reading", "second_reading", "committee",
    "third_reading", "passed", "assented",
)


def state_assembly_url(state: str) -> str:
    slug = state.strip().lower()
    if slug in STATE_ASSEMBLY_PORTALS:
        return STATE_ASSEMBLY_PORTALS[slug]
    return f"https://{slug}state.gov.ng/house-of-assembly/bills"


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text())


class StateAssemblyBillsConnector(BaseConnector):
    name = "state_assembly_bills"
    description = (
        "State Houses of Assembly bills (Lagos/Kaduna/Kano first-class, "
        "generic state fallback) — bills metadata as bill_document records "
        "(weekly cadence; fixture fallback)"
    )
    source_id = "state_assembly_bills_tracker"
    license = "State Houses of Assembly (public bills listings)"
    max_record_age_days = 14  # weekly bills cadence

    REQUIRED_KEYS = ("document_id", "title", "document_type", "metadata")

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        states = params.get("states") or ["lagos", "kaduna", "kano"]
        if isinstance(states, str):
            states = [states]
        raw: list[RawRecord] = []
        for state in states:
            slug = str(state).strip().lower()
            base = (params.get("base_url")
                    or state_assembly_url(slug)).rstrip("/")
            url = params.get("bills_url") or base
            try:
                body = self.get_json(url)
                bills = (
                    body.get("bills") or body.get("records") or body.get("data")
                    if isinstance(body, dict) else body
                ) or []
                raw.append(RawRecord(
                    provenance=self.provenance(url, body),
                    payload={
                        "jurisdiction": STATE_JURISDICTIONS.get(
                            slug, jurisdiction),
                        "state": slug,
                        "listing_url": url,
                        "bills": bills,
                    },
                ))
            except ServiceError:
                fixture_path = Path(
                    params.get("fixture_path") or DEFAULT_FIXTURE)
                fixture = _load_fixture(fixture_path)
                bills = [
                    b for b in fixture.get("bills", [])
                    if str(b.get("state", "")).lower() == slug
                ] or fixture.get("bills", [])
                raw.append(RawRecord(
                    provenance=self.provenance(None, fixture, origin="derived"),
                    payload={
                        "jurisdiction": STATE_JURISDICTIONS.get(
                            slug, jurisdiction),
                        "state": slug,
                        "listing_url": url,
                        "fixture": fixture_path.name,
                        "bills": bills,
                    },
                ))
        return raw

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for rec in raw:
            jurisdiction = rec.payload.get("jurisdiction")
            state = rec.payload.get("state") or "unknown"
            for bill in rec.payload["bills"]:
                title = (bill.get("title") or "").strip()
                chamber = str(bill.get("chamber") or "House of Assembly")
                stage = str(bill.get("stage") or "").strip().lower()
                if not title or stage not in VALID_STAGES:
                    continue
                source_url = bill.get("source_url")
                document_id = bill.get("document_id") or (
                    f"{self.source_id}:{state}:"
                    f"{hashlib.sha1(f'{state}:{title}'.encode()).hexdigest()[:16]}"
                )
                out.append(CanonicalRecord(
                    entity="bill_document",
                    provenance=rec.provenance,
                    data={
                        "document_id": document_id[:64],
                        "jurisdiction_id": jurisdiction,
                        "title": title[:512],
                        "document_type": "bill",
                        "source_url": source_url,
                        "hash": hashlib.sha256(
                            json.dumps(bill, sort_keys=True, default=str).encode()
                        ).hexdigest(),
                        "metadata": {
                            "state": state,
                            "sponsor": bill.get("sponsor"),
                            "chamber": chamber,
                            "stage": stage,
                            "date": bill.get("date"),
                            "sector": bill.get("sector"),
                            "source_document_url": source_url,
                        },
                    },
                ))
        return out
