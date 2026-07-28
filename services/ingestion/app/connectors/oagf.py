"""OAGF budget execution connector (Office of the Accountant-General of
the Federation — oagf.gov.ng).

Harvests budget execution / implementation releases — appropriated vs
released/executed amounts per MDA per quarter — and emits `budget_line`
canonical records with `tier="budget_execution"` (carrying both the
appropriation and the executed amount plus the execution rate) destined
for the platform `budgets` table.

Live path: GET the OAGF budget implementation endpoint
(OAGF_BASE_URL override). Offline fallback: when the source is
unreachable, the connector loads the bundled fixture
`tests/fixtures/oagf_execution_sample.json` and stamps every record
`origin="derived"` — the fallback is never presented as live data.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from app.errors import ServiceError
from app.models import CanonicalRecord, RawRecord
from app.connectors.base import BaseConnector

DEFAULT_BASE = os.getenv("OAGF_BASE_URL", "https://oagf.gov.ng")
DEFAULT_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "tests"
    / "fixtures"
    / "oagf_execution_sample.json"
)


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text())


class OagfConnector(BaseConnector):
    name = "oagf"
    description = (
        "OAGF budget execution/implementation releases (oagf.gov.ng) — "
        "execution vs appropriation as budget_line records with "
        "tier=budget_execution (fixture fallback)"
    )
    source_id = "oagf_budget_execution"
    license = "Office of the Accountant-General of the Federation (public releases)"
    max_record_age_days = 120  # quarterly implementation reports

    REQUIRED_KEYS = ("budget_id", "mda", "amount_ngn", "fiscal_year",
                     "appropriation_type", "tier", "appropriated_ngn",
                     "executed_ngn")

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        base = (params.get("base_url") or DEFAULT_BASE).rstrip("/")
        url = params.get("execution_url") or f"{base}/api/budget-implementation"
        try:
            body = self.get_json(url)
            rows = (
                body.get("executions") or body.get("records")
                or body.get("data")
                if isinstance(body, dict) else body
            ) or []
            return [RawRecord(
                provenance=self.provenance(url, body),
                payload={
                    "jurisdiction": jurisdiction,
                    "execution_url": url,
                    "executions": rows,
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
                    "execution_url": url,
                    "fixture": fixture_path.name,
                    "executions": fixture.get("executions", []),
                },
            )]

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for rec in raw:
            jurisdiction = rec.payload.get("jurisdiction")
            for row in rec.payload["executions"]:
                mda = (row.get("mda") or "").strip()
                appropriated = row.get("appropriated_ngn")
                executed = row.get("executed_ngn")
                period = str(row.get("period") or "").strip()
                if not mda or appropriated is None or executed is None \
                        or not period:
                    continue
                fiscal_year = int(row.get("fiscal_year") or period[:4])
                budget_id = row.get("budget_id") or (
                    f"{self.source_id}:{period}:{mda}"
                )
                execution_rate = (
                    round(float(executed) / float(appropriated), 4)
                    if float(appropriated) > 0 else None
                )
                out.append(CanonicalRecord(
                    entity="budget_line",
                    provenance=rec.provenance,
                    data={
                        "budget_id": str(budget_id)[:96],
                        "jurisdiction_id": jurisdiction,
                        "mda": mda[:255],
                        "program_code": (row.get("program_code") or "") or None,
                        "description": (
                            row.get("description")
                            or f"Budget execution for {mda} — {period}"
                        )[:512],
                        "sector_code": (row.get("sector") or "general")[:32],
                        "amount_ngn": float(executed),
                        "fiscal_year": fiscal_year,
                        "appropriation_type": "recurrent",
                        "tier": "budget_execution",
                        "appropriated_ngn": float(appropriated),
                        "executed_ngn": float(executed),
                        "execution_rate": execution_rate,
                        "period": period,
                    },
                ))
        return out
