"""iati connector tests — recorded fixtures only, NO network access."""
import json
from pathlib import Path

import httpx

from app.connectors import REGISTRY, get_connector
from app.connectors.iati import IatiConnector, DEFAULT_FIXTURE
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


def test_fixture_fallback_derived_origin():
    conn = IatiConnector(client=offline_client())
    raw = conn.fetch("jur:ng", None, {})
    assert raw[0].payload["fixture"] == "iati_activities_sample.json"
    assert raw[0].provenance.origin == "derived"
    out = conn.normalize(raw)
    assert len(out) == 6
    assert all(r.entity == "budget_line" for r in out)
    assert all(r.data["tier"] == "development_partner" for r in out)


def test_amounts_partners_and_routing():
    conn = IatiConnector(client=offline_client())
    out = conn.normalize(conn.fetch("jur:ng", None, {}))
    by_id = {r.data["budget_id"]: r.data for r in out}
    plane = by_id["iati:XI-IATI-DFID-107735"]
    assert plane["amount_ngn"] == 95000000 * 420.0
    assert plane["jurisdiction_id"] == "ng-kd"
    assert plane["partner"].startswith("UK Foreign")
    unicef = by_id["iati:XM-DAC-41122-NGA-2120"]
    assert unicef["amount_ngn"] == 48750000000
    assert unicef["jurisdiction_id"] == "ng-kn"
    usaid = by_id["iati:US-GOV-19-442-NGA-HEALTH"]
    assert usaid["jurisdiction_id"] == "jur:ng"  # no state -> run jurisdiction


def test_live_path_solr_docs_shape():
    fixture = load("iati_activities_sample.json")
    body = {"response": {"numFound": 6, "docs": fixture["docs"]}}
    conn = IatiConnector(client=mock_client({"activity/select": body}))
    raw = conn.fetch("jur:ng", None, {})
    assert raw[0].provenance.origin == "live"
    assert "recipient_country_code:NG" in raw[0].provenance.url
    out = conn.normalize(raw)
    assert len(out) == 6


def test_invalid_docs_skipped_and_contract():
    fixture = load("iati_activities_sample.json")
    fixture["docs"].append({"iati_identifier": "", "title": "no id"})
    fixture["docs"].append({"iati_identifier": "X", "title": ""})
    conn = IatiConnector(client=mock_client({"activity/select": fixture}))
    raw = conn.fetch("jur:ng", None, {})
    out = conn.normalize(raw)
    assert len(out) == 6
    contract = conn.contract_check(raw, out)
    assert contract.schema_ok and contract.freshness_ok
    assert contract.completeness_ok


def test_wiring():
    assert REGISTRY["iati"] is IatiConnector
    assert get_connector("iati").name == "iati"
    assert ENTITY_KEYS["budget_line"] == "budgets"
    assert DEFAULT_FIXTURE.exists()
    from app.scheduler import DEFAULT_CADENCE_S
    assert DEFAULT_CADENCE_S["iati"] == 30 * 24 * 3600
