"""SON connector (son.gov.ng) — standards and conformity assessment.

Harvests Standards Organisation of Nigeria publications — MANCAP/product
standards, conformity assessment programmes (SONCAP), product registration
guidelines — and emits `bill_document`-style canonical records
(`document_type="regulation"`) routed to the platform `policy_documents`
table.

Live path: GET the SON standards listing (SON_BASE_URL override).
Offline fallback: bundled fixture `tests/fixtures/son_standards.json`,
stamped `origin="derived"`.
"""
from __future__ import annotations

from app.connectors.regulator_base import RegulatorConnectorBase


class SonConnector(RegulatorConnectorBase):
    name = "son"
    description = (
        "Standards Organisation of Nigeria (son.gov.ng) — MANCAP/product "
        "standards, conformity assessment as regulation records "
        "(fixture fallback)"
    )
    source_id = "son_standards"
    license = "Standards Organisation of Nigeria (public standards notices)"

    regulator = "SON"
    default_base = "https://son.gov.ng"
    base_url_env = "SON_BASE_URL"
    listing_path = "/standards"
    fixture_name = "son_standards.json"
