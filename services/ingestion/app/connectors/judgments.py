"""Policy-relevant court judgments connector (open sources, e.g.
NigeriaLII — nigerialii.org).

Harvests metadata for policy-relevant court judgments — court, neutral
citation, parties/title, judgment date, subject sectors — and emits
`policy_document` canonical records (`document_type="judgment"`,
court/citation/subject_sectors carried in `metadata`) destined for the
platform `policy_documents` table.

Live path: GET the NigeriaLII judgments listing endpoint
(NIGERIALII_BASE_URL override). Offline fallback: when the source is
unreachable, the connector loads the bundled fixture
`tests/fixtures/judgments_sample.json` and stamps every record
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

DEFAULT_BASE = os.getenv("NIGERIALII_BASE_URL", "https://nigerialii.org")
DEFAULT_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "tests"
    / "fixtures"
    / "judgments_sample.json"
)


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text())


class JudgmentsConnector(BaseConnector):
    name = "judgments"
    description = (
        "Policy-relevant court judgments (NigeriaLII open access) as "
        "policy_document records (document_type=judgment; court, "
        "citation, subject sectors in metadata; fixture fallback)"
    )
    source_id = "nigerialii_judgments"
    license = "NigeriaLII (open access case law)"
    max_record_age_days = 45  # weekly case-law watch

    REQUIRED_KEYS = ("document_id", "title", "document_type", "metadata")

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        base = (params.get("base_url") or DEFAULT_BASE).rstrip("/")
        url = params.get("judgments_url") or f"{base}/api/judgments"
        try:
            body = self.get_json(url)
            judgments = (
                body.get("judgments") or body.get("records")
                or body.get("data")
                if isinstance(body, dict) else body
            ) or []
            return [RawRecord(
                provenance=self.provenance(url, body),
                payload={
                    "jurisdiction": jurisdiction,
                    "judgments_url": url,
                    "judgments": judgments,
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
                    "judgments_url": url,
                    "fixture": fixture_path.name,
                    "judgments": fixture.get("judgments", []),
                },
            )]

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for rec in raw:
            jurisdiction = rec.payload.get("jurisdiction")
            for j in rec.payload["judgments"]:
                title = (j.get("title") or "").strip()
                court = (j.get("court") or "").strip()
                citation = (j.get("citation") or "").strip()
                if not title or not court or not citation:
                    continue
                source_url = j.get("source_url")
                document_id = j.get("document_id") or (
                    f"{self.source_id}:"
                    f"{hashlib.sha1(citation.encode()).hexdigest()[:16]}"
                )
                out.append(CanonicalRecord(
                    entity="policy_document",
                    provenance=rec.provenance,
                    data={
                        "document_id": document_id[:64],
                        "jurisdiction_id": jurisdiction,
                        "title": title[:512],
                        "document_type": "judgment",
                        "source_url": source_url,
                        "hash": hashlib.sha256(
                            json.dumps(j, sort_keys=True, default=str).encode()
                        ).hexdigest(),
                        "metadata": {
                            "court": court,
                            "citation": citation,
                            "judgment_date": j.get("judgment_date"),
                            "subject_sectors": j.get("subject_sectors") or [],
                            "policy_relevance": j.get("policy_relevance"),
                            "source_document_url": source_url,
                        },
                    },
                ))
        return out
