"""NCC connector (ncc.gov.ng) — telecom regulatory instruments.

Harvests Nigerian Communications Commission publications — telecom licence
frameworks, spectrum instruments, Quality of Service regulations/reports —
and emits `bill_document`-style canonical records
(`document_type="regulation"`) routed to the platform `policy_documents`
table; quantitative QoS/market observations emit `sector_metric` records.

Live path: GET the NCC regulations listing (NCC_BASE_URL override).
Offline fallback: bundled fixture `tests/fixtures/ncc_instruments.json`,
stamped `origin="derived"`.
"""
from __future__ import annotations

from app.connectors.regulator_base import RegulatorConnectorBase


class NccConnector(RegulatorConnectorBase):
    name = "ncc"
    description = (
        "Nigerian Communications Commission (ncc.gov.ng) — licences, "
        "spectrum, QoS regulations as regulation records (fixture fallback)"
    )
    source_id = "ncc_regulations"
    license = "Nigerian Communications Commission (public regulations)"

    regulator = "NCC"
    default_base = "https://ncc.gov.ng"
    base_url_env = "NCC_BASE_URL"
    listing_path = "/regulations"
    fixture_name = "ncc_instruments.json"
