"""Connector registry."""
from __future__ import annotations

from app.connectors.base import BaseConnector
from app.connectors.worldbank import WorldBankConnector
from app.connectors.hdx import HDXConnector
from app.connectors.overpass import OverpassConnector
from app.connectors.nada import NadaConnector
from app.connectors.budeshi import BudeshiConnector
from app.connectors.file_harvester import FileHarvesterConnector
from app.connectors.nbs_bulletin import NbsBulletinConnector
from app.connectors.ubec_factsheet import UbecFactsheetConnector
from app.connectors.nbs_outcomes import NbsOutcomesConnector
from app.connectors.budget_office import BudgetOfficeConnector
from app.connectors.nass_bills import NassBillsConnector
from app.connectors.cbn import CbnConnector
from app.connectors.dmo import DmoConnector
from app.connectors.nbs_series import NbsSeriesConnector
from app.connectors.faac import FaacConnector
from app.connectors.oagf import OagfConnector
from app.connectors.gazettes import GazettesConnector
from app.connectors.judgments import JudgmentsConnector
from app.connectors.nitda import NitdaConnector
from app.connectors.cbn_fintech import CbnFintechConnector
from app.connectors.ncc import NccConnector
from app.connectors.nerc import NercConnector
from app.connectors.nafdac import NafdacConnector
from app.connectors.son import SonConnector
from app.connectors.ncaa import NcaaConnector
from app.connectors.state_budgets import StateBudgetsConnector
from app.connectors.state_procurement import StateProcurementConnector
from app.connectors.state_assembly_bills import StateAssemblyBillsConnector
from app.connectors.state_irs import StateIrsConnector
from app.connectors.cac import CacConnector
from app.connectors.bpp import BppConnector
from app.connectors.smedan import SmedanConnector
from app.connectors.npopc import NpopcConnector
from app.connectors.afdb import AfdbConnector
from app.connectors.afreximbank import AfreximbankConnector
from app.connectors.iati import IatiConnector

REGISTRY: dict[str, type[BaseConnector]] = {
    c.name: c
    for c in (
        WorldBankConnector,
        HDXConnector,
        OverpassConnector,
        NadaConnector,
        BudeshiConnector,
        FileHarvesterConnector,
        NbsBulletinConnector,
        UbecFactsheetConnector,
        NbsOutcomesConnector,
        BudgetOfficeConnector,
        NassBillsConnector,
        CbnConnector,
        DmoConnector,
        NbsSeriesConnector,
        FaacConnector,
        OagfConnector,
        GazettesConnector,
        JudgmentsConnector,
        NitdaConnector,
        CbnFintechConnector,
        NccConnector,
        NercConnector,
        NafdacConnector,
        SonConnector,
        NcaaConnector,
        StateBudgetsConnector,
        StateProcurementConnector,
        StateAssemblyBillsConnector,
        StateIrsConnector,
        CacConnector,
        BppConnector,
        SmedanConnector,
        NpopcConnector,
        AfdbConnector,
        AfreximbankConnector,
        IatiConnector,
    )
}


def get_connector(name: str) -> BaseConnector:
    return REGISTRY[name]()


__all__ = ["REGISTRY", "get_connector", "BaseConnector"]
