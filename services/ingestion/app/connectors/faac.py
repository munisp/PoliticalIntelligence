"""FAAC disbursements connector (Federation Account Allocation Committee).

Harvests monthly FAAC disbursements to the three tiers of government —
federal, state, local government — and emits `budget_line` canonical
records with `tier="faac_allocation"` destined for the platform
`budgets` table.

Live path: GET the FAAC disbursements endpoint (FAAC_BASE_URL override;
the Open Treasury / oAGF FAAC publication surface). Offline fallback:
when the source is unreachable, the connector loads the bundled fixture
`tests/fixtures/faac_disbursements_sample.json` and stamps every record
`origin="derived"` — the fallback is never presented as live data.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from app.errors import ServiceError
from app.models import CanonicalRecord, RawRecord
from app.connectors.base import BaseConnector

DEFAULT_BASE = os.getenv("FAAC_BASE_URL", "https://opentreasury.gov.ng")
DEFAULT_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "tests"
    / "fixtures"
    / "faac_disbursements_sample.json"
)

VALID_TIERS = ("federal", "state", "local_government")


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text())


class FaacConnector(BaseConnector):
    name = "faac"
    description = (
        "FAAC monthly disbursements (federal/state/local government) as "
        "budget_line records with tier=faac_allocation (fixture fallback)"
    )
    source_id = "faac_disbursements"
    license = "Federation Account Allocation Committee (public releases)"
    max_record_age_days = 60  # monthly disbursement cadence

    REQUIRED_KEYS = ("budget_id", "mda", "amount_ngn", "fiscal_year",
                     "appropriation_type", "tier")

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        base = (params.get("base_url") or DEFAULT_BASE).rstrip("/")
        url = params.get("disbursements_url") or f"{base}/api/faac/disbursements"
        try:
            body = self.get_json(url)
            rows = (
                body.get("disbursements") or body.get("records")
                or body.get("data")
                if isinstance(body, dict) else body
            ) or []
            return [RawRecord(
                provenance=self.provenance(url, body),
                payload={
                    "jurisdiction": jurisdiction,
                    "disbursements_url": url,
                    "disbursements": rows,
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
                    "disbursements_url": url,
                    "fixture": fixture_path.name,
                    "disbursements": fixture.get("disbursements", []),
                },
            )]

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for rec in raw:
            jurisdiction = rec.payload.get("jurisdiction")
            for row in rec.payload["disbursements"]:
                tier = str(row.get("tier") or "").strip().lower()
                amount = row.get("amount_ngn")
                period = str(row.get("period") or "").strip()
                if tier not in VALID_TIERS or amount is None or not period:
                    continue
                fiscal_year = int(row.get("fiscal_year") or period[:4])
                mda = {
                    "federal": "Federal Government of Nigeria — FAAC share",
                    "state": "State Governments — FAAC share",
                    "local_government": "Local Governments — FAAC share",
                }[tier]
                budget_id = row.get("budget_id") or (
                    f"{self.source_id}:{period}:{tier}"
                )
                out.append(CanonicalRecord(
                    entity="budget_line",
                    provenance=rec.provenance,
                    data={
                        "budget_id": str(budget_id)[:96],
                        "jurisdiction_id": jurisdiction,
                        "mda": mda,
                        "program_code": None,
                        "description": (
                            f"FAAC net disbursement to {tier.replace('_', ' ')} "
                            f"tier for {period}"
                        )[:512],
                        "sector_code": "intergovernmental",
                        "amount_ngn": float(amount),
                        "fiscal_year": fiscal_year,
                        "appropriation_type": "recurrent",
                        "tier": "faac_allocation",
                        "recipient_tier": tier,
                        "period": period,
                    },
                ))
        return out
