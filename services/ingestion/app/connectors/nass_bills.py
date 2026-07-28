"""National Assembly bills tracker connector (nass.gov.ng / placbillstrack).

Harvests bills metadata — title, sponsor, chamber, legislative stage, date,
thematic sector, source document URL — and emits `bill_document` canonical
records routed to the platform `policy_documents` table
(`document_type="bill"`, stage/sponsor/chamber carried in `metadata`).

Live path: GET the NASS bills listing (NASS_BILLS_BASE_URL override).
Offline fallback: when the source is unreachable, the connector loads the
bundled fixture `tests/fixtures/nass_bills_sample.json` and stamps every
record `origin="derived"` — the fallback is never presented as live data.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

from app.errors import ServiceError
from app.models import CanonicalRecord, RawRecord
from app.connectors.base import BaseConnector

DEFAULT_BASE = os.getenv("NASS_BILLS_BASE_URL", "https://nass.gov.ng")
DEFAULT_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "tests"
    / "fixtures"
    / "nass_bills_sample.json"
)

VALID_CHAMBERS = ("Senate", "House")
VALID_STAGES = (
    "first_reading", "second_reading", "committee",
    "third_reading", "passed", "assented",
)


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text())


class NassBillsConnector(BaseConnector):
    name = "nass_bills"
    description = (
        "National Assembly bills tracker (nass.gov.ng) — bills metadata as "
        "bill_document records (fixture fallback)"
    )
    source_id = "nass_bills_tracker"
    license = "National Assembly (public bills listing)"
    max_record_age_days = 14  # weekly bills cadence

    REQUIRED_KEYS = ("document_id", "title", "document_type", "metadata")

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        base = (params.get("base_url") or DEFAULT_BASE).rstrip("/")
        url = params.get("bills_url") or f"{base}/bills"
        try:
            body = self.get_json(url)
            bills = (
                body.get("bills") or body.get("records") or body.get("data")
                if isinstance(body, dict) else body
            ) or []
            return [RawRecord(
                provenance=self.provenance(url, body),
                payload={
                    "jurisdiction": jurisdiction,
                    "listing_url": url,
                    "bills": bills,
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
                    "listing_url": url,
                    "fixture": fixture_path.name,
                    "bills": fixture.get("bills", []),
                },
            )]

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for rec in raw:
            jurisdiction = rec.payload.get("jurisdiction")
            for bill in rec.payload["bills"]:
                title = (bill.get("title") or "").strip()
                chamber = str(bill.get("chamber") or "").strip()
                stage = str(bill.get("stage") or "").strip().lower()
                if not title or stage not in VALID_STAGES:
                    continue
                if chamber not in VALID_CHAMBERS:
                    chamber = "House" if "house" in chamber.lower() else "Senate"
                source_url = bill.get("source_url")
                document_id = bill.get("document_id") or (
                    f"{self.source_id}:"
                    f"{hashlib.sha1(f'{chamber}:{title}'.encode()).hexdigest()[:16]}"
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
