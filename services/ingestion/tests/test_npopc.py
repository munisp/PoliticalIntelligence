"""npopc connector tests — recorded fixtures only, NO network access."""
import json
from pathlib import Path

import httpx

from app.connectors import REGISTRY, get_connector
from app.connectors.npopc import NpopcConnector, DEFAULT_FIXTURE
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
    conn = NpopcConnector(client=offline_client())
    raw = conn.fetch("jur:ng", None, {})
    assert raw[0].payload["fixture"] == "npopc_projections_sample.json"
    assert raw[0].provenance.origin == "derived"
    out = conn.normalize(raw)
    assert len(out) >= 5
    assert all(r.entity == "sector_metric" for r in out)
    assert all(r.data["metric_key"].startswith("POP_") for r in out)


def test_state_and_lga_granularity():
    conn = NpopcConnector(client=offline_client())
    out = conn.normalize(conn.fetch("jur:ng", None, {}))
    kd = [r for r in out if r.data["jurisdiction_id"] == "ng-kd"
          and r.data["metric_key"] == "POP_TOTAL" and not r.data.get("lga")]
    assert kd[0].data["value"] == 9252000
    lga_rows = [r for r in out if r.data.get("lga") == "Zaria"]
    assert lga_rows
    assert all(r.data["state"] == "Kaduna" for r in lga_rows)
    assert all(r.data["sector_code"] == "demography" for r in out)
    assert all(r.data["confidence"] == 0.7 for r in out)


def test_live_path_live_origin_and_state_filter():
    fixture = load("npopc_projections_sample.json")
    conn = NpopcConnector(client=mock_client({"state-lga": fixture}))
    raw = conn.fetch("jur:ng", None, {})
    assert raw[0].provenance.origin == "live"
    assert raw[0].provenance.url.startswith(
        "https://nationalpopulation.gov.ng/projections/state-lga")
    conn2 = NpopcConnector(client=offline_client())
    raw2 = conn2.fetch("jur:ng-kd", None, {"state": "Kaduna"})
    out2 = conn2.normalize(raw2)
    assert out2
    assert all(r.data["state"] == "Kaduna" for r in out2)


def test_rows_without_period_skipped_and_contract():
    fixture = load("npopc_projections_sample.json")
    fixture["rows"].append({"state": "Lagos", "population": 1})
    conn = NpopcConnector(client=mock_client({"state-lga": fixture}))
    raw = conn.fetch("jur:ng", None, {})
    out = conn.normalize(raw)
    assert all(r.data["period"] for r in out)
    contract = conn.contract_check(raw, out)
    assert contract.schema_ok and contract.freshness_ok
    assert contract.completeness_ok


def test_wiring():
    assert REGISTRY["npopc"] is NpopcConnector
    assert get_connector("npopc").name == "npopc"
    assert ENTITY_KEYS["sector_metric"] == "sector_metrics"
    assert DEFAULT_FIXTURE.exists()
    from app.scheduler import DEFAULT_CADENCE_S
    assert DEFAULT_CADENCE_S["npopc"] == 30 * 24 * 3600
