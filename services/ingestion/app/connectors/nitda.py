"""NITDA connector (nitda.gov.ng) — digital-economy regulatory instruments.

Harvests National Information Technology Development Agency publications —
NDPR/NDPA data-protection guidance, Nigeria Startup Act implementation
notices, digital-economy frameworks — and emits `bill_document`-style
canonical records (`document_type="regulation"`) routed to the platform
`policy_documents` table (regulator/instrument_type/subject_sectors in
`metadata`).

Live path: GET the NITDA publications listing (NITDA_BASE_URL override).
Offline fallback: bundled fixture `tests/fixtures/nitda_instruments.json`,
stamped `origin="derived"`.
"""
from __future__ import annotations

from app.connectors.regulator_base import RegulatorConnectorBase


class NitdaConnector(RegulatorConnectorBase):
    name = "nitda"
    description = (
        "NITDA (nitda.gov.ng) — digital-economy frameworks, NDPR/NDPA "
        "guidance, Startup Act notices as regulation records (fixture fallback)"
    )
    source_id = "nitda_regulations"
    license = "NITDA (public regulations and guidelines)"

    regulator = "NITDA"
    default_base = "https://nitda.gov.ng"
    base_url_env = "NITDA_BASE_URL"
    listing_path = "/regulations"
    fixture_name = "nitda_instruments.json"
