"""state_procurement connector tests — recorded fixtures only, NO network."""
import json
from pathlib import Path

import httpx

from app.connectors import REGISTRY, get_connector
from app.connectors.state_procurement import (
    DEFAULT_FIXTURE,
    StateProcurementConnector,
    state_procurement_url,
)
from app.loader import ENTITY_KEYS

FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str):
    return json.loads((FIXTURES / name).read_text())


def mock_client(routes: dict[str, object]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        for key, body in routes.items():
            if key in str(request.url):
                status, payload = (200, body) if not isinstance(body, tuple) else body
                return httpx.Response(status, json=payload)
        return httpx.Response(404, json={"error": "not mocked"})
    return httpx.Client(transport=httpx.MockTransport(handler))


def offline_client() -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("unreachable", request=request)
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_fixture_fallback_and_derived_origin():
    conn = StateProcurementConnector(client=offline_client())
    raw = conn.fetch("jur:ng-kd", None, {})
    assert len(raw) == 3
    assert all(r.payload["fixture"] == "state_procurement_sample.json"
               for r in raw)
    assert all(r.provenance.origin == "derived" for r in raw)
    out = conn.normalize(raw)
    assert len(out) == 6
    assert all(r.entity == "procurement_record" for r in out)
    assert all(r.provenance.origin == "derived" for r in out)


def test_normalize_fields_and_state_routing():
    conn = StateProcurementConnector(client=offline_client())
    out = conn.normalize(conn.fetch("jur:ng-kd", None, {}))
    by_ocid = {r.data["ocid"]: r.data for r in out}
    kd = by_ocid["ocds-213f4a-kdsg-2024-009"]
    assert kd["buyer"].startswith("Kaduna State Ministry of Public Works")
    assert kd["supplier"] == "Reynolds Construction Company"
    assert kd["value_ngn"] == 4750000000
    assert kd["award_date"] == "2024-02-14"
    assert kd["jurisdiction_id"] == "ng-kd"
    assert kd["state"] == "kaduna"
    lagos = [r for r in out if r.data["state"] == "lagos"]
    assert all(r.data["jurisdiction_id"] == "ng-la" for r in lagos)


def test_live_path_uses_portal_and_live_origin():
    fixture = load("state_procurement_sample.json")
    kaduna = {"records": [r for r in fixture["records"]
                          if r["state"] == "kaduna"]}
    conn = StateProcurementConnector(client=mock_client(
        {"kdppa.kdsg.gov.ng": kaduna}))
    raw = conn.fetch("jur:ng-kd", None, {"states": ["kaduna"]})
    assert raw[0].provenance.origin == "live"
    assert raw[0].provenance.url.startswith(
        "https://kdppa.kdsg.gov.ng/api/awards")
    out = conn.normalize(raw)
    assert len(out) == 2
    assert all(r.data["state"] == "kaduna" for r in out)


def test_generic_state_fallback_and_missing_ocid_skipped():
    assert state_procurement_url("kaduna").startswith("https://kdppa")
    assert state_procurement_url("oyo") == (
        "https://oyostate.gov.ng/procurement/awards")
    fixture = load("state_procurement_sample.json")
    fixture["records"].append({"state": "oyo", "title": "no ocid"})
    conn = StateProcurementConnector(client=mock_client(
        {"oyostate.gov.ng": {"records": fixture["records"]}}))
    raw = conn.fetch("jur:ng-oy", None, {"states": ["oyo"]})
    out = conn.normalize(raw)
    assert len(out) == 6  # record without ocid skipped
    assert raw[0].payload["jurisdiction"] == "jur:ng-oy"


def test_contract_and_wiring():
    conn = StateProcurementConnector(client=offline_client())
    raw = conn.fetch("jur:ng-kd", None, {})
    out = conn.normalize(raw)
    contract = conn.contract_check(raw, out)
    assert contract.schema_ok and contract.freshness_ok
    assert contract.completeness_ok
    assert REGISTRY["state_procurement"] is StateProcurementConnector
    assert get_connector("state_procurement").name == "state_procurement"
    assert ENTITY_KEYS["procurement_record"] == "procurement_records"
    assert DEFAULT_FIXTURE.exists()
    from app.scheduler import DEFAULT_CADENCE_S
    assert DEFAULT_CADENCE_S["state_procurement"] == 30 * 24 * 3600
