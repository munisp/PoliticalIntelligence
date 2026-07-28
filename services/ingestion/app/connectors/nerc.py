"""NERC connector (nerc.gov.ng) — electricity regulatory instruments.

Harvests Nigerian Electricity Regulatory Commission publications — tariff
(MYTO) orders, mini-grid/embedded generation regulations, metering
regulations — and emits `bill_document`-style canonical records
(`document_type="regulation"`) routed to the platform `policy_documents`
table; quantitative tariff/metering observations emit `sector_metric`
records.

Live path: GET the NERC regulations listing (NERC_BASE_URL override).
Offline fallback: bundled fixture `tests/fixtures/nerc_orders.json`,
stamped `origin="derived"`.
"""
from __future__ import annotations

from app.connectors.regulator_base import RegulatorConnectorBase


class NercConnector(RegulatorConnectorBase):
    name = "nerc"
    description = (
        "Nigerian Electricity Regulatory Commission (nerc.gov.ng) — tariff "
        "orders, mini-grid/embedded generation, metering regs as regulation "
        "records (fixture fallback)"
    )
    source_id = "nerc_regulations"
    license = "NERC (public orders and regulations)"

    regulator = "NERC"
    default_base = "https://nerc.gov.ng"
    base_url_env = "NERC_BASE_URL"
    listing_path = "/regulations"
    fixture_name = "nerc_orders.json"
