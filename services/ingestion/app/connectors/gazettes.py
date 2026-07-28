"""Federal + state gazettes connector.

Harvests gazette records — laws and legal notices *as published* in the
Federal Republic of Nigeria Official Gazette and state gazettes — and
emits `policy_document` canonical records (`document_type="gazette"`)
destined for the platform `policy_documents` table.

Live path: GET the gazette listing endpoint (GAZETTES_BASE_URL
override; the Laws of the Federation / federal printing press
publication surface). Offline fallback: when the source is unreachable,
the connector loads the bundled fixture
`tests/fixtures/gazettes_sample.json` and stamps every record
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

DEFAULT_BASE = os.getenv(
    "GAZETTES_BASE_URL", "https://lawnigeria.com")
DEFAULT_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "tests"
    / "fixtures"
    / "gazettes_sample.json"
)

VALID_LEVELS = ("federal", "state")


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text())


class GazettesConnector(BaseConnector):
    name = "gazettes"
    description = (
        "Federal + state gazettes — laws as published as policy_document "
        "records (document_type=gazette, fixture fallback)"
    )
    source_id = "official_gazettes"
    license = "Official Gazette publications (public legal notices)"
    max_record_age_days = 45  # gazettes published irregularly; weekly poll

    REQUIRED_KEYS = ("document_id", "title", "document_type", "metadata")

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        base = (params.get("base_url") or DEFAULT_BASE).rstrip("/")
        url = params.get("gazettes_url") or f"{base}/api/gazettes"
        try:
            body = self.get_json(url)
            gazettes = (
                body.get("gazettes") or body.get("records")
                or body.get("data")
                if isinstance(body, dict) else body
            ) or []
            return [RawRecord(
                provenance=self.provenance(url, body),
                payload={
                    "jurisdiction": jurisdiction,
                    "gazettes_url": url,
                    "gazettes": gazettes,
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
                    "gazettes_url": url,
                    "fixture": fixture_path.name,
                    "gazettes": fixture.get("gazettes", []),
                },
            )]

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for rec in raw:
            jurisdiction = rec.payload.get("jurisdiction")
            for gaz in rec.payload["gazettes"]:
                title = (gaz.get("title") or "").strip()
                level = str(gaz.get("level") or "").strip().lower()
                gazette_no = (gaz.get("gazette_no") or "").strip()
                if not title or level not in VALID_LEVELS or not gazette_no:
                    continue
                source_url = gaz.get("source_url")
                document_id = gaz.get("document_id") or (
                    f"{self.source_id}:"
                    f"{hashlib.sha1(f'{level}:{gazette_no}:{title}'.encode()).hexdigest()[:16]}"
                )
                out.append(CanonicalRecord(
                    entity="policy_document",
                    provenance=rec.provenance,
                    data={
                        "document_id": document_id[:64],
                        "jurisdiction_id": jurisdiction,
                        "title": title[:512],
                        "document_type": "gazette",
                        "source_url": source_url,
                        "hash": hashlib.sha256(
                            json.dumps(gaz, sort_keys=True, default=str).encode()
                        ).hexdigest(),
                        "metadata": {
                            "level": level,
                            "gazette_no": gazette_no,
                            "volume": gaz.get("volume"),
                            "published_on": gaz.get("published_on"),
                            "state": gaz.get("state"),
                            "subject_sectors": gaz.get("subject_sectors") or [],
                            "source_document_url": source_url,
                        },
                    },
                ))
        return out
