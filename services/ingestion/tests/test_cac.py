"""cac connector tests — recorded fixtures only, NO network access."""
import json
from pathlib import Path

import httpx

from app.connectors import REGISTRY, get_connector
from app.connectors.cac import CacConnector, DEFAULT_FIXTURE
from app.loader import ENTITY_KEYS
from app.models import CanonicalRecord

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


def test_fixture_fallback_derived_origin():
    conn = CacConnector(client=offline_client())
    raw = conn.fetch("jur:ng", None, {})
    assert raw[0].payload["fixture"] == "cac_registrations_sample.json"
    assert raw[0].provenance.origin == "derived"
    out = conn.normalize(raw)
    assert len(out) == 7
    assert all(r.entity == "business_registration" for r in out)
    assert all(r.provenance.origin == "derived" for r in out)


def test_schema_matches_business_registrations_columns():
    conn = CacConnector(client=offline_client())
    out = conn.normalize(conn.fetch("jur:ng", None, {}))
    for r in out:
        d = r.data
        assert d["registration_id"] and len(d["registration_id"]) <= 96
        assert d["name"]
        assert d["entity_type"] in (
            "limited_liability", "business_name", "incorporated_trustees",
            "limited_partnership", "llp")
        assert d["registered_at"]
        assert d["status"] == "active"
    zaria = [r for r in out if r.data["name"].startswith("Zaria Agro")][0]
    assert zaria.data["rc_number"] == "RC1849203"
    assert zaria.data["jurisdiction_id"] == "ng-kd"
    assert zaria.data["lga"] == "Zaria"
    assert zaria.data["sector"] == "agriculture"
    fct = [r for r in out if r.data["state"] == "FCT"][0]
    assert fct.data["jurisdiction_id"] == "ng-fc"


def test_live_path_and_state_filter():
    fixture = load("cac_registrations_sample.json")
    conn = CacConnector(client=mock_client({"registrations": fixture}))
    raw = conn.fetch("jur:ng-kd", None, {"state": "Kaduna"})
    assert raw[0].provenance.origin == "live"
    assert "state=Kaduna" in raw[0].provenance.url
    out = conn.normalize(raw)
    assert out  # live payload not state-filtered server-side in the mock
    conn2 = CacConnector(client=offline_client())
    raw2 = conn2.fetch("jur:ng-kd", None, {"state": "Kaduna"})
    out2 = conn2.normalize(raw2)
    assert len(out2) == 2
    assert all(r.data["state"] == "Kaduna" for r in out2)


def test_invalid_rows_skipped_and_contract():
    fixture = load("cac_registrations_sample.json")
    fixture["records"].append({"name": "", "registered_at": "2025-01-01"})
    fixture["records"].append({"name": "No Date Ltd", "rc_number": "RC1"})
    conn = CacConnector(client=mock_client({"registrations": fixture}))
    raw = conn.fetch("jur:ng", None, {})
    out = conn.normalize(raw)
    assert len(out) == 7  # both bad rows skipped
    contract = conn.contract_check(raw, out)
    assert contract.schema_ok and contract.freshness_ok
    assert contract.completeness_ok


def test_wiring_and_entity_literal():
    assert REGISTRY["cac"] is CacConnector
    assert get_connector("cac").name == "cac"
    assert ENTITY_KEYS["business_registration"] == "business_registrations"
    assert DEFAULT_FIXTURE.exists()
    rec = CanonicalRecord(
        entity="business_registration",
        data={"registration_id": "x"},
        provenance=get_connector("cac").provenance(None, {}),
    )
    assert rec.entity == "business_registration"
    from app.scheduler import DEFAULT_CADENCE_S
    assert DEFAULT_CADENCE_S["cac"] == 30 * 24 * 3600
