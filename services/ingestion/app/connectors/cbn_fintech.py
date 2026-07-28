"""CBN fintech/payments circulars connector (cbn.gov.ng).

Harvests Central Bank of Nigeria payments-system circulars and guidelines —
PSSP/PTSP/PSB licence categories, open-banking guidelines, agent-banking
rules — and emits `bill_document`-style canonical records
(`document_type="regulation"`) routed to the platform `policy_documents`
table (regulator/instrument_type/subject_sectors in `metadata`).

Scope note: distinct from the batch-A `cbn.py` macro-statistics connector;
this pack covers fintech/payments regulatory instruments only.

Live path: GET the CBN circulars listing (CBN_FINTECH_BASE_URL override).
Offline fallback: bundled fixture
`tests/fixtures/cbn_fintech_circulars.json`, stamped `origin="derived"`.
"""
from __future__ import annotations

from app.connectors.regulator_base import RegulatorConnectorBase


class CbnFintechConnector(RegulatorConnectorBase):
    name = "cbn_fintech"
    description = (
        "CBN fintech/payments circulars (cbn.gov.ng) — PSSP/PTSP/PSB "
        "licences, open banking, agent banking as regulation records "
        "(fixture fallback)"
    )
    source_id = "cbn_fintech_circulars"
    license = "Central Bank of Nigeria (public circulars)"

    regulator = "CBN"
    default_base = "https://www.cbn.gov.ng"
    base_url_env = "CBN_FINTECH_BASE_URL"
    listing_path = "/documents/circulars"
    fixture_name = "cbn_fintech_circulars.json"
