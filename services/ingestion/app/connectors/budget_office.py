"""Budget Office of the Federation connector (budgetoffice.gov.ng).

Harvests national budget publications — appropriation acts, budget
implementation reports, MTEF/FSP documents — and emits `budget_line`
canonical records (MDA, program/project code, description, sector,
amount_ngn, fiscal_year, appropriation_type) destined for the platform
`budgets` table.

Live path: GET the Budget Office publications listing
(BUDGET_OFFICE_BASE_URL override). Offline fallback: when the source is
unreachable, the connector loads the bundled fixture
`tests/fixtures/budget_office_2025_sample.json` (2025 appropriation capital
lines) and stamps every record `origin="derived"` — the fallback is never
presented as live data.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from app.errors import ServiceError
from app.models import CanonicalRecord, RawRecord
from app.connectors.base import BaseConnector

DEFAULT_BASE = os.getenv("BUDGET_OFFICE_BASE_URL", "https://budgetoffice.gov.ng")
DEFAULT_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "tests"
    / "fixtures"
    / "budget_office_2025_sample.json"
)

VALID_APPROPRIATION_TYPES = ("capital", "recurrent")


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text())


class BudgetOfficeConnector(BaseConnector):
    name = "budget_office"
    description = (
        "Budget Office of the Federation (budgetoffice.gov.ng) — national "
        "budget publications as budget_line records (fixture fallback)"
    )
    source_id = "budget_office_federation"
    license = "Budget Office of the Federation (public publications)"
    max_record_age_days = 120  # quarterly budget cadence

    REQUIRED_KEYS = (
        "budget_id", "mda", "amount_ngn", "fiscal_year", "appropriation_type",
    )

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        fiscal_year = int(params.get("fiscal_year", 2025))
        base = (params.get("base_url") or DEFAULT_BASE).rstrip("/")
        url = params.get("publications_url") or (
            f"{base}/publications/appropriation-act/{fiscal_year}"
        )
        try:
            body = self.get_json(url)
            lines = (
                body.get("lines") or body.get("records") or body.get("data")
                if isinstance(body, dict) else body
            ) or []
            return [RawRecord(
                provenance=self.provenance(url, body),
                payload={
                    "jurisdiction": jurisdiction,
                    "index_url": url,
                    "lines": lines,
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
                    "index_url": url,
                    "fixture": fixture_path.name,
                    "lines": fixture.get("lines", []),
                },
            )]

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for rec in raw:
            jurisdiction = rec.payload.get("jurisdiction")
            for line in rec.payload["lines"]:
                mda = (line.get("mda") or "").strip()
                program_code = (line.get("program_code") or "").strip()
                appropriation_type = str(
                    line.get("appropriation_type") or "capital"
                ).lower()
                if not mda or appropriation_type not in VALID_APPROPRIATION_TYPES:
                    continue
                fiscal_year = int(line.get("fiscal_year")
                                  or rec.payload.get("fiscal_year") or 0)
                amount = line.get("amount_ngn")
                budget_id = (
                    line.get("budget_id")
                    or f"{self.source_id}:{fiscal_year}:{program_code or mda}"
                )
                out.append(CanonicalRecord(
                    entity="budget_line",
                    provenance=rec.provenance,
                    data={
                        "budget_id": str(budget_id)[:96],
                        "jurisdiction_id": jurisdiction,
                        "mda": mda[:255],
                        "program_code": program_code or None,
                        "description": (line.get("description") or "")[:512],
                        "sector_code": (line.get("sector") or "general")[:32],
                        "amount_ngn": float(amount) if amount is not None else None,
                        "fiscal_year": fiscal_year,
                        "appropriation_type": appropriation_type,
                    },
                ))
        return out
