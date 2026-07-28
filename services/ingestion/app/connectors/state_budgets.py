"""State budget portals connector (feat-conn-subnat-firms).

Harvests state appropriation data — approved budget lines per MDA/sector —
from Nigerian state budget portals. Lagos (lagosstate.gov.ng budget
publications), Kaduna (kdsg.gov.ng / openkaduna), and Kano (kanostate.gov.ng)
are first-class with explicit portal URLs; any other state falls back to a
generic `https://<state>state.gov.ng/budget` pattern.

Emits: budget_line records with `tier="state"` destined for the platform
`budgets` table (jurisdiction FK = run jurisdiction).

Live path: GET the state budget publications listing
(STATE_BUDGETS_BASE_URL override per state). Offline fallback: when the
source is unreachable, the connector loads the bundled fixture
`tests/fixtures/state_budgets_sample.json` and stamps every record
`origin="derived"` — the fallback is never presented as live data.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from app.errors import ServiceError
from app.models import CanonicalRecord, RawRecord
from app.connectors.base import BaseConnector

DEFAULT_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "tests"
    / "fixtures"
    / "state_budgets_sample.json"
)

# First-class state budget portals (approved budget / citizens' budget JSON
# or listing endpoints where published).
STATE_PORTALS: dict[str, str] = {
    "lagos": os.getenv(
        "LAGOS_BUDGET_URL",
        "https://lagosstate.gov.ng/budget/publications",
    ),
    "kaduna": os.getenv(
        "KADUNA_BUDGET_URL",
        "https://budget.kdsg.gov.ng/api/publications",
    ),
    "kano": os.getenv(
        "KANO_BUDGET_URL",
        "https://kanostate.gov.ng/budget/publications",
    ),
}

# state slug -> platform jurisdiction id (state-level admin units).
STATE_JURISDICTIONS: dict[str, str] = {
    "lagos": "ng-la",
    "kaduna": "ng-kd",
    "kano": "ng-kn",
}

VALID_APPROPRIATION_TYPES = ("capital", "recurrent")


def state_portal_url(state: str) -> str:
    """Portal URL for a state slug; generic gov.ng pattern as fallback."""
    slug = state.strip().lower()
    if slug in STATE_PORTALS:
        return STATE_PORTALS[slug]
    return f"https://{slug}state.gov.ng/budget/publications"


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text())


class StateBudgetsConnector(BaseConnector):
    name = "state_budgets"
    description = (
        "State budget portals (Lagos/Kaduna/Kano first-class, generic state "
        "fallback) — state appropriation lines as budget_line records "
        "(tier=state; fixture fallback)"
    )
    source_id = "state_budget_portals"
    license = "State governments (public budget publications)"
    max_record_age_days = 45  # monthly refresh cadence

    REQUIRED_KEYS = (
        "budget_id", "mda", "amount_ngn", "fiscal_year",
        "appropriation_type", "tier",
    )

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        fiscal_year = int(params.get("fiscal_year", 2025))
        states = params.get("states") or ["lagos", "kaduna", "kano"]
        if isinstance(states, str):
            states = [states]
        raw: list[RawRecord] = []
        for state in states:
            slug = str(state).strip().lower()
            base = (params.get("base_url") or state_portal_url(slug)).rstrip("/")
            url = params.get("publications_url") or (
                f"{base}/approved-budget/{fiscal_year}"
            )
            try:
                body = self.get_json(url)
                lines = (
                    body.get("lines") or body.get("records") or body.get("data")
                    if isinstance(body, dict) else body
                ) or []
                raw.append(RawRecord(
                    provenance=self.provenance(url, body),
                    payload={
                        "jurisdiction": STATE_JURISDICTIONS.get(
                            slug, jurisdiction),
                        "state": slug,
                        "fiscal_year": fiscal_year,
                        "index_url": url,
                        "lines": lines,
                    },
                ))
            except ServiceError:
                fixture_path = Path(
                    params.get("fixture_path") or DEFAULT_FIXTURE)
                fixture = _load_fixture(fixture_path)
                lines = [
                    ln for ln in fixture.get("lines", [])
                    if str(ln.get("state", "")).lower() == slug
                ] or fixture.get("lines", [])
                raw.append(RawRecord(
                    provenance=self.provenance(None, fixture, origin="derived"),
                    payload={
                        "jurisdiction": STATE_JURISDICTIONS.get(
                            slug, jurisdiction),
                        "state": slug,
                        "fiscal_year": fiscal_year,
                        "index_url": url,
                        "fixture": fixture_path.name,
                        "lines": lines,
                    },
                ))
        return raw

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for rec in raw:
            jurisdiction = rec.payload.get("jurisdiction")
            state = rec.payload.get("state") or "unknown"
            for line in rec.payload["lines"]:
                mda = (line.get("mda") or "").strip()
                program_code = (line.get("program_code") or "").strip()
                appropriation_type = str(
                    line.get("appropriation_type") or "capital"
                ).lower()
                if not mda or appropriation_type not in VALID_APPROPRIATION_TYPES:
                    continue
                fiscal_year = int(
                    line.get("fiscal_year")
                    or rec.payload.get("fiscal_year") or 0
                )
                amount = line.get("amount_ngn")
                budget_id = line.get("budget_id") or (
                    f"{self.source_id}:{state}:{fiscal_year}:"
                    f"{program_code or mda}"
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
                        "amount_ngn": (
                            float(amount) if amount is not None else None),
                        "released_ngn": (
                            float(line["released_ngn"])
                            if line.get("released_ngn") is not None else None),
                        "fiscal_year": fiscal_year,
                        "appropriation_type": appropriation_type,
                        "tier": "state",
                        "state": state,
                    },
                ))
        return out
