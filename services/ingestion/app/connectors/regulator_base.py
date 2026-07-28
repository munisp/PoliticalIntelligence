"""Shared base for Nigerian sector-regulator connectors.

Pattern (mirrors nass_bills.py): each regulator connector harvests a
publications listing — circulars, guidelines, frameworks, regulations,
licence categories — and emits `bill_document`-style canonical records
(`document_type="regulation"`) routed by the loader to the platform
`policy_documents` table, with regulator/instrument_type/subject_sectors
carried in `metadata`. Instruments that carry quantitative observations
(fixture `metrics` list) additionally emit `sector_metric` records.

Live path: GET the regulator's publications listing (per-connector
*_BASE_URL env override). Offline fallback: when the source is
unreachable, the connector loads its bundled fixture and stamps every
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

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "tests" / "fixtures"


class RegulatorConnectorBase(BaseConnector):
    """Common fetch/normalize plumbing for regulator instrument listings."""

    regulator = ""            # e.g. "NITDA"
    default_base = ""         # e.g. "https://nitda.gov.ng"
    base_url_env = ""         # e.g. "NITDA_BASE_URL"
    listing_path = "/"        # publications listing path
    fixture_name = ""         # bundled fixture filename
    max_record_age_days = 31  # monthly regulatory cadence

    REQUIRED_KEYS = ("document_id", "title", "document_type", "metadata")

    # -- fixture ------------------------------------------------------------
    @classmethod
    def default_fixture(cls) -> Path:
        return FIXTURES_DIR / cls.fixture_name

    @staticmethod
    def _load_fixture(path: Path) -> dict:
        return json.loads(path.read_text())

    # -- fetch ----------------------------------------------------------------
    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        base = (
            params.get("base_url")
            or os.getenv(self.base_url_env, self.default_base)
        ).rstrip("/")
        url = params.get("instruments_url") or f"{base}{self.listing_path}"
        try:
            body = self.get_json(url)
            instruments = (
                body.get("instruments") or body.get("circulars")
                or body.get("regulations") or body.get("guidelines")
                or body.get("records") or body.get("data")
                if isinstance(body, dict) else body
            ) or []
            return [RawRecord(
                provenance=self.provenance(url, body),
                payload={
                    "jurisdiction": jurisdiction,
                    "listing_url": url,
                    "instruments": instruments,
                },
            )]
        except ServiceError:
            fixture_path = Path(
                params.get("fixture_path") or self.default_fixture()
            )
            fixture = self._load_fixture(fixture_path)
            return [RawRecord(
                provenance=self.provenance(None, fixture, origin="derived"),
                payload={
                    "jurisdiction": jurisdiction,
                    "listing_url": url,
                    "fixture": fixture_path.name,
                    "instruments": fixture.get("instruments", []),
                },
            )]

    # -- contract -----------------------------------------------------------
    def contract_check(self, raw, normalized):
        # REQUIRED_KEYS describe regulation documents; quantitative
        # sector_metric side-outputs follow the worldbank key set.
        docs = [r for r in normalized if r.entity == "bill_document"]
        result = super().contract_check(raw, docs)
        result.records_out = len(normalized)
        return result

    # -- normalize -------------------------------------------------------------
    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for rec in raw:
            jurisdiction = rec.payload.get("jurisdiction")
            for inst in rec.payload["instruments"]:
                title = (inst.get("title") or "").strip()
                instrument_type = (inst.get("instrument_type") or "").strip()
                if not title or not instrument_type:
                    continue
                sectors = inst.get("subject_sectors") or []
                if isinstance(sectors, str):
                    sectors = [sectors]
                source_url = inst.get("source_url")
                digest = hashlib.sha1(
                    f"{self.regulator}:{title}".encode()
                ).hexdigest()[:16]
                document_id = inst.get("document_id") or (
                    f"{self.source_id}:{digest}"
                )
                out.append(CanonicalRecord(
                    entity="bill_document",
                    provenance=rec.provenance,
                    data={
                        "document_id": document_id[:64],
                        "jurisdiction_id": jurisdiction,
                        "title": title[:512],
                        "document_type": "regulation",
                        "source_url": source_url,
                        "hash": hashlib.sha256(
                            json.dumps(inst, sort_keys=True, default=str).encode()
                        ).hexdigest(),
                        "metadata": {
                            "regulator": self.regulator,
                            "instrument_type": instrument_type,
                            "subject_sectors": sectors,
                            "reference": inst.get("reference"),
                            "issued_date": inst.get("issued_date"),
                            "source_document_url": source_url,
                        },
                    },
                ))
                for metric in inst.get("metrics") or []:
                    if metric.get("value") is None or not metric.get("metric_key"):
                        continue
                    out.append(CanonicalRecord(
                        entity="sector_metric",
                        provenance=rec.provenance,
                        data={
                            "jurisdiction_id": jurisdiction,
                            "sector_code": (metric.get("sector_code")
                                            or (sectors[0] if sectors
                                                else "general"))[:32],
                            "metric_key": str(metric["metric_key"])[:64],
                            "indicator_id": f"{self.source_id}:{metric['metric_key']}",
                            "value": float(metric["value"]),
                            "period": str(metric.get("period")
                                          or inst.get("issued_date", "")[:4]),
                            "confidence": 0.8,
                        },
                    ))
        return out
