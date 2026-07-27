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
    )
}


def get_connector(name: str) -> BaseConnector:
    return REGISTRY[name]()


__all__ = ["REGISTRY", "get_connector", "BaseConnector"]
