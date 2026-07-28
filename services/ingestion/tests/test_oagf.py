"""oagf connector tests — recorded fixtures only, NO network access."""
import json
from pathlib import Path

import httpx

from app.connectors import REGISTRY, get_connector
from app.connectors.oagf import OagfConnector, DEFAULT_FIXTURE
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


def test_fixture_fallback_triggers_when_source_unreachable():
    conn = OagfConnector(client=offline_client())
    raw = conn.fetch("jur:ng", None, {})
    assert len(raw) == 1
    assert raw[0].payload["fixture"] == "oagf_execution_sample.json"
    assert len(raw[0].payload["executions"]) >= 6


def test_fixture_mode_deterministic():
    conn = OagfConnector(client=offline_client())
    out1 = conn.normalize(conn.fetch("jur:ng", None, {}))
    out2 = conn.normalize(conn.fetch("jur:ng", None, {}))
    assert [r.data for r in out1] == [r.data for r in out2]
    assert len(out1) >= 6


def test_provenance_stamping_derived_origin():
    conn = OagfConnector(client=offline_client())
    raw = conn.fetch("jur:ng", None, {})
    prov = raw[0].provenance
    assert prov.origin == "derived"
    assert prov.source_id == "oagf_budget_execution"
    assert prov.checksum.startswith("sha256:")
    out = conn.normalize(raw)
    assert all(r.provenance.origin == "derived" for r in out)


def test_entity_shape_execution_vs_appropriation():
    conn = OagfConnector(client=offline_client())
    out = conn.normalize(conn.fetch("jur:ng", None, {}))
    assert all(r.entity == "budget_line" for r in out)
    for r in out:
        d = r.data
        assert d["tier"] == "budget_execution"
        assert d["budget_id"] and len(d["budget_id"]) <= 96
        assert d["jurisdiction_id"] == "jur:ng"
        assert isinstance(d["appropriated_ngn"], float)
        assert isinstance(d["executed_ngn"], float)
        assert d["amount_ngn"] == d["executed_ngn"]
        assert d["execution_rate"] is None or 0 <= d["execution_rate"] <= 10
    # execution vs appropriation math: health 2024-Q1 = 198.75/345.0
    health_q1 = next(r for r in out
                     if r.data["mda"] == "Federal Ministry of Health"
                     and r.data["period"] == "2024-Q1")
    assert health_q1.data["execution_rate"] == 0.5761
    contract = conn.contract_check(conn.fetch("jur:ng", None, {}), out)
    assert contract.schema_ok and contract.freshness_ok and contract.completeness_ok


def test_live_path_uses_source_url_and_live_origin():
    fixture = load("oagf_execution_sample.json")
    conn = OagfConnector(client=mock_client({"budget-implementation": fixture}))
    raw = conn.fetch("jur:ng", None, {})
    assert raw[0].provenance.origin == "live"
    assert raw[0].provenance.url.startswith("https://oagf.gov.ng/")
    assert "fixture" not in raw[0].payload
    out = conn.normalize(raw)
    assert len(out) == 6  # row with empty mda skipped


def test_invalid_rows_skipped():
    fixture = load("oagf_execution_sample.json")
    fixture["executions"].append(
        {"period": "2024-Q3", "mda": "X", "appropriated_ngn": None,
         "executed_ngn": 1.0})
    fixture["executions"].append(
        {"period": "", "mda": "Y", "appropriated_ngn": 1.0,
         "executed_ngn": 1.0})
    conn = OagfConnector(client=mock_client({"budget-implementation": fixture}))
    out = conn.normalize(conn.fetch("jur:ng", None, {}))
    assert len(out) == 6
    assert all(r.data["mda"] not in ("", "X", "Y") for r in out)


def test_registry_and_loader_wiring():
    assert REGISTRY["oagf"] is OagfConnector
    assert get_connector("oagf").name == "oagf"
    assert ENTITY_KEYS["budget_line"] == "budgets"
    assert DEFAULT_FIXTURE.exists()
    rec = CanonicalRecord(
        entity="budget_line",
        data={"budget_id": "x", "tier": "budget_execution"},
        provenance=get_connector("oagf").provenance(None, {}),
    )
    assert rec.entity == "budget_line"


def test_scheduler_cadence_monthly():
    from app.scheduler import DEFAULT_CADENCE_S
    assert DEFAULT_CADENCE_S["oagf"] == 30 * 24 * 3600
