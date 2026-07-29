"""State Internal Revenue Service (SIRS) connector (feat-conn-subnat-firms).

Harvests published revenue performance data and tax guides from state
internal revenue services — Lagos (LIRS), Kaduna (KADIRS), Kano (KIRS)
first-class; generic state fallback. Two record classes:

  - revenue performance -> sector_metric records (metric_key prefix
    `SIRS_`, e.g. SIRS_IGR_TOTAL_NGN) routed to `sector_metrics`;
  - published tax guides / revenue codes (legal instruments) ->
    bill_document records (`document_type="legal_instrument"`) routed to
    `policy_documents`.

Live path: GET the state SIRS publications listing (per-state base URL
override via params). Offline fallback: when the source is unreachable, the
connector loads the bundled fixture `tests/fixtures/state_irs_sample.json`
and stamps every record `origin="derived"` — the fallback is never
presented as live data.
"""
from __future__ import annotations

import hashlib
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
    / "state_irs_sample.json"
)

STATE_IRS_PORTALS: dict[str, str] = {
    "lagos": os.getenv("LIRS_URL", "https://lirs.gov.ng/publications"),
    "kaduna": os.getenv("KADIRS_URL", "https://kadirs.kdsg.gov.ng/publications"),
    "kano": os.getenv("KIRS_URL", "https://kirs.gov.ng/publications"),
}

STATE_JURISDICTIONS: dict[str, str] = {
    "lagos": "ng-la",
    "kaduna": "ng-kd",
    "kano": "ng-kn",
}

# fixture/live metric keys -> canonical sector metric keys
METRIC_KEYS = {
    "igr_total_ngn": "SIRS_IGR_TOTAL_NGN",
    "paye_ngn": "SIRS_PAYE_NGN",
    "road_levies_ngn": "SIRS_ROAD_LEVIES_NGN",
    "direct_assessment_ngn": "SIRS_DIRECT_ASSESSMENT_NGN",
    "mda_revenue_ngn": "SIRS_MDA_REVENUE_NGN",
}


def state_irs_url(state: str) -> str:
    slug = state.strip().lower()
    if slug in STATE_IRS_PORTALS:
        return STATE_IRS_PORTALS[slug]
    return f"https://{slug}irs.gov.ng/publications"


def _load_fixture(path: Path) -> dict:
    return json.loads(path.read_text())


class StateIrsConnector(BaseConnector):
    name = "state_irs"
    description = (
        "State Internal Revenue Services (LIRS/KADIRS/KIRS first-class, "
        "generic fallback) — published revenue performance as SIRS_* "
        "sector_metrics and tax guides as policy_documents (fixture fallback)"
    )
    source_id = "state_irs_publications"
    license = "State internal revenue services (published reports/guides)"
    max_record_age_days = 45  # monthly refresh cadence

    REQUIRED_KEYS = ("metric_key", "value", "period")

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        states = params.get("states") or ["lagos", "kaduna", "kano"]
        if isinstance(states, str):
            states = [states]
        raw: list[RawRecord] = []
        for state in states:
            slug = str(state).strip().lower()
            base = (params.get("base_url")
                    or state_irs_url(slug)).rstrip("/")
            url = params.get("publications_url") or f"{base}/revenue-guides"
            try:
                body = self.get_json(url)
                raw.append(RawRecord(
                    provenance=self.provenance(url, body),
                    payload={
                        "jurisdiction": STATE_JURISDICTIONS.get(
                            slug, jurisdiction),
                        "state": slug,
                        "listing_url": url,
                        "revenue": (body.get("revenue") or [])
                        if isinstance(body, dict) else [],
                        "guides": (body.get("guides") or [])
                        if isinstance(body, dict) else [],
                    },
                ))
            except ServiceError:
                fixture_path = Path(
                    params.get("fixture_path") or DEFAULT_FIXTURE)
                fixture = _load_fixture(fixture_path)
                revenue = [
                    r for r in fixture.get("revenue", [])
                    if str(r.get("state", "")).lower() == slug
                ] or fixture.get("revenue", [])
                guides = [
                    g for g in fixture.get("guides", [])
                    if str(g.get("state", "")).lower() == slug
                ] or fixture.get("guides", [])
                raw.append(RawRecord(
                    provenance=self.provenance(None, fixture, origin="derived"),
                    payload={
                        "jurisdiction": STATE_JURISDICTIONS.get(
                            slug, jurisdiction),
                        "state": slug,
                        "listing_url": url,
                        "fixture": fixture_path.name,
                        "revenue": revenue,
                        "guides": guides,
                    },
                ))
        return raw

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for rec in raw:
            jurisdiction = rec.payload.get("jurisdiction")
            state = rec.payload.get("state") or "unknown"
            for row in rec.payload["revenue"]:
                period = str(row.get("period") or "").strip()
                for src_key, metric_key in METRIC_KEYS.items():
                    value = row.get(src_key)
                    if not period or value is None:
                        continue
                    out.append(CanonicalRecord(
                        entity="sector_metric",
                        provenance=rec.provenance,
                        data={
                            "jurisdiction_id": jurisdiction,
                            "sector_code": "public_finance",
                            "metric_key": metric_key,
                            "value": float(value),
                            "period": period[:16],
                            "confidence": 0.8,
                            "source_id": self.source_id,
                            "state": state,
                        },
                    ))
            for guide in rec.payload["guides"]:
                title = (guide.get("title") or "").strip()
                if not title:
                    continue
                source_url = guide.get("source_url")
                document_id = guide.get("document_id") or (
                    f"{self.source_id}:{state}:"
                    f"{hashlib.sha1(f'{state}:{title}'.encode()).hexdigest()[:16]}"
                )
                out.append(CanonicalRecord(
                    entity="bill_document",
                    provenance=rec.provenance,
                    data={
                        "document_id": document_id[:64],
                        "jurisdiction_id": jurisdiction,
                        "title": title[:512],
                        "document_type": "legal_instrument",
                        "source_url": source_url,
                        "hash": hashlib.sha256(
                            json.dumps(guide, sort_keys=True, default=str).encode()
                        ).hexdigest(),
                        "metadata": {
                            "state": state,
                            "instrument_type": guide.get("instrument_type")
                            or "tax_guide",
                            "issued_by": guide.get("issued_by")
                            or f"{state.title()} State Internal Revenue Service",
                            "date": guide.get("date"),
                            "source_document_url": source_url,
                        },
                    },
                ))
        return out
