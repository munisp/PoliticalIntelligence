"""NCAA connector (ncaa.gov.ng) — civil aviation regulatory instruments.

Harvests Nigerian Civil Aviation Authority publications — Nigeria Civil
Aviation Regulations (NigCARs), drone/RPAS rules, aerodrome licensing —
and emits `bill_document`-style canonical records
(`document_type="regulation"`) routed to the platform `policy_documents`
table; quantitative observations (e.g. registered RPAS operators) emit
`sector_metric` records.

Live path: GET the NCAA regulations listing (NCAA_BASE_URL override).
Offline fallback: bundled fixture `tests/fixtures/ncaa_regs.json`,
stamped `origin="derived"`.
"""
from __future__ import annotations

from app.connectors.regulator_base import RegulatorConnectorBase


class NcaaConnector(RegulatorConnectorBase):
    name = "ncaa"
    description = (
        "Nigerian Civil Aviation Authority (ncaa.gov.ng) — NigCARs, "
        "drone/RPAS rules, aerodrome licensing as regulation records "
        "(fixture fallback)"
    )
    source_id = "ncaa_regulations"
    license = "NCAA (public regulations and advisory circulars)"

    regulator = "NCAA"
    default_base = "https://ncaa.gov.ng"
    base_url_env = "NCAA_BASE_URL"
    listing_path = "/regulations"
    fixture_name = "ncaa_regs.json"
