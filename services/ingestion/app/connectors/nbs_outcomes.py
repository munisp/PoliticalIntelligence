"""NBS Nigeria labour-force outcomes connector — realized outcome series.

Fetches realized indicator series (UNEMPLOYMENT_RATE, EMPLOYMENT_TOTAL,
FIRM_COUNT) published by the National Bureau of Statistics of Nigeria
(Nigeria Labour Force Survey / labour statistics reports) and normalizes
them into ``outcome_observation`` canonical records for the platform's
realized-outcome store (docs/OUTCOMES.md, feature G2).

The NBS does not expose a stable machine-readable API for these releases,
so the connector fetches a curated JSON extract endpoint
(``params["extract_url"]``, default: the platform-hosted mirror) and —
when the live endpoint is unreachable (offline CI, source outage) — falls
back to the recorded offline fixture shipped at
``services/ingestion/tests/fixtures/nbs_labour_force.json``. Fixture
fallbacks are provenance-stamped ``origin="derived"`` so they are never
mistaken for live pulls.

Wire shape of the extract (also the fixture shape)::

    {
      "source": "...", "release": "...", "url": "...",
      "jurisdiction_id": "jur:ng",
      "series": [
        {"indicator_code": "UNEMPLOYMENT_RATE", "unit": "percent",
         "frequency": "quarterly",
         "observations": [{"period": "2024-03", "value": 5.3}, ...]}
      ]
    }

Quarterly/annual observations use the period END month (YYYY-MM), matching
the outcome_observations.period contract (varchar(7)).
"""
from __future__ import annotations

import json
from pathlib import Path

import httpx

from app.connectors.base import BaseConnector
from app.errors import ServiceError
from app.models import CanonicalRecord, RawRecord

DEFAULT_EXTRACT_URL = (
    "https://www.nigerianstat.gov.ng/api/elibrary/labour-force/latest.json"
)
FIXTURE_PATH = (
    Path(__file__).resolve().parents[2] / "tests" / "fixtures"
    / "nbs_labour_force.json"
)


class NbsOutcomesConnector(BaseConnector):
    name = "nbs_outcomes"
    description = "NBS Nigeria labour-force realized outcome series"
    source_id = "nbs_labour_force"
    license = "NBS Nigeria open data"
    max_record_age_days = 400  # quarterly statistics cadence

    REQUIRED_KEYS = (
        "jurisdiction_id", "indicator_code", "unit", "frequency",
        "period", "value",
    )

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        url = params.get("extract_url", DEFAULT_EXTRACT_URL)
        try:
            body = self.get_json(url)
            origin = "live"
        except ServiceError:
            if params.get("allow_fixture_fallback", True):
                body = json.loads(FIXTURE_PATH.read_text())
                origin = "derived"
            else:
                raise
        if params.get("offline_fixture"):
            body = json.loads(FIXTURE_PATH.read_text())
            origin = "derived"
        return [
            RawRecord(
                provenance=self.provenance(
                    url if origin == "live" else body.get("url"),
                    body,
                    origin=origin,
                ),
                payload=body,
            )
        ]

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for rec in raw:
            body = rec.payload
            jurisdiction = body.get("jurisdiction_id", "jur:ng")
            for series in body.get("series", []):
                for obs in series.get("observations", []):
                    if obs.get("value") is None:
                        continue  # unreleased / redacted period
                    out.append(
                        CanonicalRecord(
                            entity="outcome_observation",
                            provenance=rec.provenance,
                            data={
                                "jurisdiction_id": jurisdiction,
                                "indicator_code": series["indicator_code"],
                                "unit": series["unit"],
                                "frequency": series["frequency"],
                                "source": body.get("source", self.source_id),
                                "period": str(obs["period"]),
                                "value": float(obs["value"]),
                            },
                        )
                    )
        return out
