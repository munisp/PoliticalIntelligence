"""African Development Bank (AfDB) Nigeria portfolio connector
(feat-conn-subnat-firms).

Harvests the AfDB project portfolio for Nigeria from the AfDB projects
API/data portal — project id, title, sector, status, approved amount,
implementing MDA/state — and emits two record classes:

  - budget_line records (`tier="development_partner"`) with the approved
    financing amount (NGN-converted where the source publishes USD, using
    the record's stated exchange rate) -> `budgets` table;
  - evidence_source records (project appraisal citation + excerpt) ->
    `evidence_sources` table.

Live path: GET the AfDB Nigeria projects listing (AFDB_BASE_URL
override). Offline fallback: when the source is unreachable, the
connector loads the bundled fixture
`tests/fixtures/afdb_projects_sample.json` and stamps every record
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
    "AFDB_BASE_URL", "https://projectsportal.afdb.org/dataportal/VProject")
DEFAULT_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "tests"
    / "fixtures"
    / "afdb_projects_sample.json"
)

STATE_JURISDICTIONS: dict[str, str] = {
    "lagos": "ng-la",
    "kaduna": "ng-kd",
    "kano": "ng-kn",
}


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text())


class AfdbConnector(BaseConnector):
    name = "afdb"
    description = (
        "African Development Bank Nigeria portfolio — project financing as "
        "budget_line records (tier=development_partner) plus appraisal "
        "evidence_sources (fixture fallback)"
    )
    source_id = "afdb_projects"
    license = "African Development Bank open data (projects portal)"
    max_record_age_days = 45  # monthly refresh cadence

    REQUIRED_KEYS = ("budget_id", "mda", "fiscal_year", "tier")

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        base = (params.get("base_url") or DEFAULT_BASE).rstrip("/")
        url = params.get("projects_url") or f"{base}/query/NGA"
        try:
            body = self.get_json(url)
            projects = (
                body.get("projects") or body.get("records") or body.get("data")
                if isinstance(body, dict) else body
            ) or []
            return [RawRecord(
                provenance=self.provenance(url, body),
                payload={
                    "jurisdiction": jurisdiction,
                    "listing_url": url,
                    "projects": projects,
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
                    "projects": fixture.get("projects", []),
                },
            )]

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for rec in raw:
            jurisdiction = rec.payload.get("jurisdiction")
            for p in rec.payload["projects"]:
                project_id = (p.get("project_id") or "").strip()
                title = (p.get("title") or "").strip()
                if not project_id or not title:
                    continue
                amount_ngn = p.get("amount_ngn")
                if amount_ngn is None and p.get("amount_usd") is not None:
                    rate = float(p.get("exchange_rate_ngn_per_usd") or 1500.0)
                    amount_ngn = float(p["amount_usd"]) * rate
                state = str(p.get("state") or "").strip()
                row_jurisdiction = STATE_JURISDICTIONS.get(
                    state.lower(), jurisdiction)
                year = int(p.get("approval_year") or 0)
                sector = (p.get("sector") or "general")[:32]
                out.append(CanonicalRecord(
                    entity="budget_line",
                    provenance=rec.provenance,
                    data={
                        "budget_id": f"afdb:{project_id}"[:96],
                        "jurisdiction_id": row_jurisdiction,
                        "mda": (
                            p.get("implementing_agency")
                            or f"AfDB — {sector} portfolio")[:255],
                        "program_code": project_id[:64],
                        "description": title[:512],
                        "sector_code": sector,
                        "amount_ngn": (
                            float(amount_ngn) if amount_ngn is not None else None),
                        "fiscal_year": year,
                        "appropriation_type": "capital",
                        "tier": "development_partner",
                        "partner": "African Development Bank",
                        "state": state or None,
                        "status": p.get("status") or "active",
                    },
                ))
                excerpt = (p.get("excerpt") or title)[:2000]
                out.append(CanonicalRecord(
                    entity="evidence_source",
                    provenance=rec.provenance,
                    data={
                        "evidence_source_id": (
                            f"afdb:evidence:{project_id}"[:96]),
                        "jurisdiction_id": row_jurisdiction,
                        "citation": (
                            f"African Development Bank — {title} "
                            f"(project {project_id}, approved {year})")[:2000],
                        "source_url": p.get("source_url"),
                        "content_excerpt": excerpt,
                        "confidence": 0.8,
                        "linked_entity_ids": {
                            "budget_ids": [f"afdb:{project_id}"[:96]]},
                        "hash": hashlib.sha256(
                            json.dumps(p, sort_keys=True, default=str).encode()
                        ).hexdigest(),
                    },
                ))
        return out
