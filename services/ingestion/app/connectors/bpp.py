"""Bureau of Public Procurement (BPP) connector (feat-conn-subnat-firms).

Harvests federal contract award notices — NOCOPO-certified awards
published by the Bureau of Public Procurement (bpp.gov.ng) — as
OCDS-shaped records.

Emits: procurement_records (buyer, supplier, value, award date, status,
ocid) for federal MDAs.

Live path: GET the BPP awards listing (BPP_BASE_URL override). Offline
fallback: when the source is unreachable, the connector loads the bundled
fixture `tests/fixtures/bpp_awards_sample.json` and stamps every record
`origin="derived"` — the fallback is never presented as live data.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from app.errors import ServiceError
from app.models import CanonicalRecord, RawRecord
from app.connectors.base import BaseConnector

DEFAULT_BASE = os.getenv("BPP_BASE_URL", "https://bpp.gov.ng")
DEFAULT_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "tests"
    / "fixtures"
    / "bpp_awards_sample.json"
)


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text())


class BppConnector(BaseConnector):
    name = "bpp"
    description = (
        "Bureau of Public Procurement (bpp.gov.ng) — federal NOCOPO "
        "contract awards as procurement_records (fixture fallback)"
    )
    source_id = "bpp_nocopo"
    license = "Bureau of Public Procurement (published award notices)"
    max_record_age_days = 45  # monthly refresh cadence

    REQUIRED_KEYS = ("buyer", "ocid")

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        base = (params.get("base_url") or DEFAULT_BASE).rstrip("/")
        limit = int(params.get("limit", 100))
        url = params.get("awards_url") or (
            f"{base}/nocopo/awards?limit={limit}")
        try:
            body = self.get_json(url)
            records = (
                body if isinstance(body, list)
                else body.get("records") or body.get("data")
                or body.get("awards") or []
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
            return [RawRecord(
                provenance=self.provenance(None, fixture, origin="derived"),
                payload={
                    "jurisdiction": jurisdiction,
                    "listing_url": url,
                    "fixture": fixture_path.name,
                    "records": fixture.get("records", []),
                },
            )]

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
                ocid = r.get("ocid") or r.get("nocopo_no") or r.get("id")
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
                        "nocopo_no": (r.get("nocopo_no") or "")[:64] or None,
                        "tier": "federal",
                    },
                ))
        return out
