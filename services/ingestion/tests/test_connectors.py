"""Connector tests — recorded fixtures only, NO network access."""
import json
from pathlib import Path

import httpx
import pytest

from app.connectors import REGISTRY, get_connector
from app.connectors.budeshi import BudeshiConnector
from app.connectors.hdx import HDXConnector
from app.connectors.nada import NadaConnector
from app.connectors.overpass import OverpassConnector
from app.connectors.worldbank import WorldBankConnector

FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str):
    return json.loads((FIXTURES / name).read_text())


def mock_client(routes: dict[str, object]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        for key, body in routes.items():
            if key in str(request.url):
                status, payload = (200, body) if not isinstance(body, tuple) else body
                if isinstance(payload, (dict, list)):
                    return httpx.Response(status, json=payload)
                if isinstance(payload, bytes):
                    return httpx.Response(status, content=payload)
                return httpx.Response(status, content=str(payload))
        return httpx.Response(404, json={"error": "not mocked"})
    return httpx.Client(transport=httpx.MockTransport(handler))


# ---------------------------------------------------------------------------
# World Bank
# ---------------------------------------------------------------------------
def test_worldbank_fetch_normalize_nga():
    conn = WorldBankConnector(client=mock_client(
        {"SP.POP.TOTL": load("worldbank_nga_pop.json")}))
    raw = conn.fetch("nga", "2021", {"country_iso3": "NGA",
                                     "indicators": ["SP.POP.TOTL"]})
    assert len(raw) == 1
    prov = raw[0].provenance
    assert prov.origin == "live"
    assert prov.source_id == "worldbank_api"
    assert prov.url.startswith("https://api.worldbank.org/v2/country/NGA")
    assert prov.checksum.startswith("sha256:")
    out = conn.normalize(raw)
    assert len(out) == 3
    assert all(r.entity == "sector_metric" for r in out)
    latest = max(out, key=lambda r: r.data["period"])
    assert latest.data["metric_key"] == "population"
    assert latest.data["value"] == 227882945
    assert latest.data["period"] == "2023"
    contract = conn.contract_check(raw, out)
    assert contract.schema_ok and contract.freshness_ok and contract.completeness_ok


def test_worldbank_generality_kenya_same_code_path():
    """Generality proof: identical connector ingests KEN with no code change."""
    conn = WorldBankConnector(client=mock_client(
        {"SP.POP.TOTL": load("worldbank_ken_pop.json")}))
    raw = conn.fetch("ken", None, {"country_iso3": "KEN",
                                   "indicators": ["SP.POP.TOTL"]})
    assert "country/KEN" in raw[0].provenance.url
    out = conn.normalize(raw)
    assert len(out) == 3
    assert all(r.data["jurisdiction_id"] == "KEN" for r in out)


def test_worldbank_skips_null_observations():
    fixture = load("worldbank_nga_pop.json")
    fixture[1][0]["value"] = None
    conn = WorldBankConnector(client=mock_client({"SP.POP.TOTL": fixture}))
    out = conn.normalize(conn.fetch("nga", None, {"indicators": ["SP.POP.TOTL"]}))
    assert len(out) == 2


# ---------------------------------------------------------------------------
# Overpass
# ---------------------------------------------------------------------------
def test_overpass_normalize_and_geometry_rules():
    conn = OverpassConnector(client=mock_client(
        {"interpreter": load("overpass_kaduna_schools.json")}))
    raw = conn.fetch("ng-kd", None, {"area_name": "Kaduna", "amenity": "school"})
    assert "overpass.kumi.systems" in raw[0].provenance.url
    out = conn.normalize(raw)
    # 3 elements with geometry; the way without center is skipped.
    assert len(out) == 3
    named = {r.data["name"] for r in out}
    assert "Government Secondary School Kaduna" in named
    assert all(r.data["type"] == "school" for r in out)
    assert all(isinstance(r.data["lat"], float) for r in out)
    assert all(r.data["source"].startswith("osm:") for r in out)


def test_overpass_retries_to_second_mirror():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        if "kumi" in str(request.url):
            return httpx.Response(429, text="rate limited")
        return httpx.Response(200, json=load("overpass_kaduna_schools.json"))

    conn = OverpassConnector(client=httpx.Client(
        transport=httpx.MockTransport(handler)))
    raw = conn.fetch("ng-kd", None, {"area_name": "Kaduna", "amenity": "school"})
    assert len(calls) == 2
    assert "overpass-api.de" in raw[0].provenance.url


def test_overpass_rejects_unknown_amenity():
    from app.errors import ServiceError
    conn = OverpassConnector(client=mock_client({}))
    with pytest.raises(ServiceError) as ei:
        conn.fetch("ng-kd", None, {"amenity": "casino"})
    assert ei.value.code == "INVALID_PARAMS"


# ---------------------------------------------------------------------------
# HDX
# ---------------------------------------------------------------------------
def test_hdx_catalog_records():
    conn = HDXConnector(client=mock_client(
        {"package_search": load("hdx_search.json")}))
    raw = conn.fetch("nga", None, {"queries": ["nigeria health facilities"],
                                   "download_csv": False})
    assert raw[0].provenance.url.startswith(
        "https://data.humdata.org/api/3/action/package_search")
    out = conn.normalize(raw)
    assert len(out) == 2
    assert all(r.entity == "data_source" for r in out)
    ids = {r.data["source_id"] for r in out}
    assert "hdx:nigeria-health-facilities" in ids


def test_hdx_csv_resource_to_facilities():
    csv_text = (
        "name,facility_type,latitude,longitude\n"
        "PHC Kawo,Primary Health Centre,10.556,7.441\n"
        "Bad Row,Clinic,not-a-number,7.4\n"
        ",Clinic,10.5,7.4\n"
    )
    fixture = load("hdx_search.json")
    fixture["result"]["results"][0]["resources"] = [
        {"name": "facilities.csv", "format": "CSV",
         "url": "https://data.humdata.org/dataset/x/facilities.csv", "id": "r1"}
    ]
    conn = HDXConnector(client=mock_client({
        "package_search": fixture,
        "facilities.csv": (200, csv_text),
    }))
    raw = conn.fetch("nga", None, {"queries": ["x"], "download_csv": True})
    out = conn.normalize(raw)
    facilities = [r for r in out if r.entity == "facility"]
    assert len(facilities) == 1
    assert facilities[0].data["name"] == "PHC Kawo"
    assert facilities[0].data["lat"] == 10.556


# ---------------------------------------------------------------------------
# NADA
# ---------------------------------------------------------------------------
def test_nada_catalog_metadata():
    conn = NadaConnector(client=mock_client(
        {"catalog/search": load("nada_search.json")}))
    raw = conn.fetch("nga", None, {})
    out = conn.normalize(raw)
    assert len(out) == 2
    assert all(r.entity == "data_source" for r in out)
    first = out[0].data
    assert first["source_id"].startswith("nada:NGA-NBS-")
    assert first["authoring_entity"]
    assert first["catalog_url"].startswith(
        "https://microdata.nigerianstat.gov.ng/index.php/catalog/")


# ---------------------------------------------------------------------------
# Budeshi
# ---------------------------------------------------------------------------
def test_budeshi_procurement_records():
    conn = BudeshiConnector(client=mock_client(
        {"projects": load("budeshi_projects.json")}))
    raw = conn.fetch("ng-kd", None, {"buyer": "Kaduna State"})
    out = conn.normalize(raw)
    assert len(out) == 2  # record without ocid skipped
    first = out[0].data
    assert first["ocid"] == "ocds-213f4a-kdsg-2023-001"
    assert first["buyer"] == "Kaduna State Ministry of Health"
    assert first["supplier"] == "Buildwell Nigeria Ltd"
    assert first["value_ngn"] == 84500000
    assert first["award_date"] == "2023-06-14"
    assert all(r.entity == "procurement_record" for r in out)


def test_registry_complete():
    assert set(REGISTRY) == {"worldbank", "hdx", "overpass", "nada",
                             "budeshi", "file_harvester",
                             "nbs_bulletin", "ubec_factsheet"}
    for name in REGISTRY:
        assert get_connector(name).name == name
