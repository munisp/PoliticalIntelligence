"""NAFDAC connector (nafdac.gov.ng) — food/drug/cosmetics regulatory instruments.

Harvests National Agency for Food and Drug Administration and Control
publications — product registration categories, food/drug/cosmetics
guidelines — and emits `bill_document`-style canonical records
(`document_type="regulation"`) routed to the platform `policy_documents`
table.

Live path: GET the NAFDAC regulations listing (NAFDAC_BASE_URL override).
Offline fallback: bundled fixture
`tests/fixtures/nafdac_guidelines.json`, stamped `origin="derived"`.
"""
from __future__ import annotations

from app.connectors.regulator_base import RegulatorConnectorBase


class NafdacConnector(RegulatorConnectorBase):
    name = "nafdac"
    description = (
        "NAFDAC (nafdac.gov.ng) — product registration categories, "
        "food/drug/cosmetics guidelines as regulation records "
        "(fixture fallback)"
    )
    source_id = "nafdac_regulations"
    license = "NAFDAC (public guidelines and regulations)"

    regulator = "NAFDAC"
    default_base = "https://www.nafdac.gov.ng"
    base_url_env = "NAFDAC_BASE_URL"
    listing_path = "/regulations"
    fixture_name = "nafdac_guidelines.json"
