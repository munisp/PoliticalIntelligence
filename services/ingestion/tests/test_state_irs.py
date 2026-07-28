"""state_irs connector tests — recorded fixtures only, NO network access."""
import json
from pathlib import Path

import httpx

from app.connectors import REGISTRY, get_connector
from app.connectors.state_irs import (
    DEFAULT_FIXTURE,
    StateIrsConnector,
    state_irs_url,
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


def test_fixture_fallback_derived_origin():
    conn = StateIrsConnector(client=offline_client())
    raw = conn.fetch("jur:ng-kd", None, {})
    assert len(raw) == 3
    assert all(r.provenance.origin == "derived" for r in raw)
    out = conn.normalize(raw)
    assert len(out) >= 5
    assert all(r.provenance.origin == "derived" for r in out)


def test_revenue_rows_emit_sirs_metrics():
    conn = StateIrsConnector(client=offline_client())
    out = conn.normalize(conn.fetch("jur:ng-kd", None, {}))
    metrics = [r for r in out if r.entity == "sector_metric"]
    assert metrics
    assert all(r.data["metric_key"].startswith("SIRS_") for r in metrics)
    assert all(r.data["sector_code"] == "public_finance" for r in metrics)
    lagos_2024 = [r for r in metrics
                  if r.data["state"] == "lagos" and r.data["period"] == "2024"
                  and r.data["metric_key"] == "SIRS_IGR_TOTAL_NGN"]
    assert lagos_2024[0].data["value"] == 940610000000
    assert lagos_2024[0].data["jurisdiction_id"] == "ng-la"


def test_guides_emit_legal_instruments():
    conn = StateIrsConnector(client=offline_client())
    out = conn.normalize(conn.fetch("jur:ng-kd", None, {}))
    docs = [r for r in out if r.entity == "bill_document"]
    assert len(docs) == 3
    assert all(d.data["document_type"] == "legal_instrument" for d in docs)
    assert all(d.data["metadata"]["state"] for d in docs)
    kd = [d for d in docs if d.data["metadata"]["state"] == "kaduna"]
    assert kd[0].data["metadata"]["instrument_type"] == "tax_guide"


def test_live_path_live_origin():
    fixture = load("state_irs_sample.json")
    kaduna = {
        "revenue": [r for r in fixture["revenue"] if r["state"] == "kaduna"],
        "guides": [g for g in fixture["guides"] if g["state"] == "kaduna"],
    }
    conn = StateIrsConnector(client=mock_client({"kadirs": kaduna}))
    raw = conn.fetch("jur:ng-kd", None, {"states": ["kaduna"]})
    assert raw[0].provenance.origin == "live"
    assert raw[0].provenance.url.startswith(
        "https://kadirs.kdsg.gov.ng/publications/")
    out = conn.normalize(raw)
    assert out
    assert all(r.data.get("state") == "kaduna"
               or r.data["metadata"]["state"] == "kaduna" for r in out)


def test_contract_and_wiring():
    conn = StateIrsConnector(client=offline_client())
    raw = conn.fetch("jur:ng-kd", None, {})
    out = conn.normalize(raw)
    metrics = [r for r in out if r.entity == "sector_metric"]
    contract = conn.contract_check(raw, metrics)
    assert contract.schema_ok and contract.freshness_ok
    assert contract.completeness_ok
    assert state_irs_url("lagos") == "https://lirs.gov.ng/publications"
    assert state_irs_url("bauchi") == "https://bauchiirs.gov.ng/publications"
    assert REGISTRY["state_irs"] is StateIrsConnector
    assert get_connector("state_irs").name == "state_irs"
    assert ENTITY_KEYS["sector_metric"] == "sector_metrics"
    assert ENTITY_KEYS["bill_document"] == "policy_documents"
    assert DEFAULT_FIXTURE.exists()
    from app.scheduler import DEFAULT_CADENCE_S
    assert DEFAULT_CADENCE_S["state_irs"] == 30 * 24 * 3600
