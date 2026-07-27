"""Budeshi (PPDC) OCDS procurement connector — LIVE-API/DOWNLOAD (§6).

Budeshi publishes Nigerian procurement (incl. NOCOPO/BPP and state records)
in Open Contracting Data Standard format. The SPA frontend is served from
budeshi.ng; the JSON API base is configurable (BUDESHI_BASE_URL) because the
deployment host has moved between budeshi.ng and budeshi-engine.vercel.app.

Emits: procurement_records (buyer, supplier, value, award date, status, ocid).

NOTE: at build time the API host was unreachable from the dev sandbox
(egress-filtered); the connector is written against the documented OCDS
release shape and validated against fixtures. See docs/INGESTION.md.
"""
from __future__ import annotations

import os

from app.models import CanonicalRecord, RawRecord
from app.connectors.base import BaseConnector

DEFAULT_BASE = os.getenv("BUDESHI_BASE_URL", "https://budeshi-engine.vercel.app/api")


class BudeshiConnector(BaseConnector):
    name = "budeshi"
    description = "Budeshi OCDS — Nigerian procurement records (buyer/supplier/value)"
    source_id = "budeshi_ocds"
    license = "PPDC Budeshi open data"

    REQUIRED_KEYS = ("buyer", "ocid")

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        base = (params.get("base_url") or DEFAULT_BASE).rstrip("/")
        buyer = params.get("buyer")  # e.g. "Kaduna State"
        limit = int(params.get("limit", 100))
        url = f"{base}/projects?limit={limit}" + (f"&buyer={buyer}" if buyer else "")
        body = self.get_json(url)
        records = body if isinstance(body, list) else body.get("records") or body.get("data") or []
        return [RawRecord(
            provenance=self.provenance(url, body),
            payload={"records": records[:limit]},
        )]

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for rec in raw:
            for r in rec.payload["records"]:
                buyer = r.get("buyer") or r.get("procuringEntity") or {}
                buyer_name = buyer.get("name") if isinstance(buyer, dict) else str(buyer)
                awards = r.get("awards") or ([r["award"]] if r.get("award") else [{}])
                award = awards[0] if awards else {}
                suppliers = award.get("suppliers") or r.get("suppliers") or []
                supplier = suppliers[0].get("name") if suppliers and isinstance(suppliers[0], dict) else None
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
                        "buyer": (buyer_name or "unknown")[:255],
                        "supplier": (supplier or "")[:255] or None,
                        "value_ngn": float(amount) if amount is not None else None,
                        "award_date": str(award.get("date") or r.get("date") or "")[:32] or None,
                        "status": str(r.get("status") or award.get("status") or "unknown")[:32],
                        "title": (r.get("title") or r.get("tender", {}).get("title") or "")[:255],
                    },
                ))
        return out
