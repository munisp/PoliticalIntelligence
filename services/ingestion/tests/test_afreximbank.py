"""afreximbank connector tests — recorded fixtures only, NO network access."""
import json
from pathlib import Path

import httpx

from app.connectors import REGISTRY, get_connector
from app.connectors.afreximbank import AfreximbankConnector, DEFAULT_FIXTURE
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
    conn = AfreximbankConnector(client=offline_client())
    raw = conn.fetch("jur:ng", None, {})
    assert raw[0].payload["fixture"] == (
        "afreximbank_announcements_sample.json")
    assert raw[0].provenance.origin == "derived"
    out = conn.normalize(raw)
    assert len(out) == 5
    assert all(r.entity == "budget_line" for r in out)
    assert all(r.data["tier"] == "development_partner" for r in out)
    assert all(r.data["partner"] == "Afreximbank" for r in out)


def test_amounts_and_routing():
    conn = AfreximbankConnector(client=offline_client())
    out = conn.normalize(conn.fetch("jur:ng", None, {}))
    by_id = {r.data["budget_id"]: r.data for r in out}
    boi = by_id["afreximbank:AFRX-NG-2024-011"]
    assert boi["amount_ngn"] == 300000000 * 1480.0
    assert boi["jurisdiction_id"] == "jur:ng"  # no state -> run jurisdiction
    kd = by_id["afreximbank:AFRX-NG-2023-047"]
    assert kd["jurisdiction_id"] == "ng-kd"
    assert kd["instrument"] == "project_loan"
    ngn = by_id["afreximbank:AFRX-NG-2022-009"]
    assert ngn["amount_ngn"] == 19125000000


def test_live_path_live_origin():
    fixture = load("afreximbank_announcements_sample.json")
    conn = AfreximbankConnector(client=mock_client({"announcements": fixture}))
    raw = conn.fetch("jur:ng", None, {})
    assert raw[0].provenance.origin == "live"
    assert "country=Nigeria" in raw[0].provenance.url
    out = conn.normalize(raw)
    assert len(out) == 5


def test_invalid_rows_skipped_and_contract():
    fixture = load("afreximbank_announcements_sample.json")
    fixture["rows"].append({"facility_id": "", "title": "no id"})
    fixture["rows"].append({"facility_id": "X-1", "title": ""})
    conn = AfreximbankConnector(client=mock_client({"announcements": fixture}))
    raw = conn.fetch("jur:ng", None, {})
    out = conn.normalize(raw)
    assert len(out) == 5
    contract = conn.contract_check(raw, out)
    assert contract.schema_ok and contract.freshness_ok
    assert contract.completeness_ok


def test_wiring():
    assert REGISTRY["afreximbank"] is AfreximbankConnector
    assert get_connector("afreximbank").name == "afreximbank"
    assert ENTITY_KEYS["budget_line"] == "budgets"
    assert DEFAULT_FIXTURE.exists()
    from app.scheduler import DEFAULT_CADENCE_S
    assert DEFAULT_CADENCE_S["afreximbank"] == 30 * 24 * 3600
