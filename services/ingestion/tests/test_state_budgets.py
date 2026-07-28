"""state_budgets connector tests — recorded fixtures only, NO network access."""
import json
from pathlib import Path

import httpx

from app.connectors import REGISTRY, get_connector
from app.connectors.state_budgets import (
    DEFAULT_FIXTURE,
    StateBudgetsConnector,
    state_portal_url,
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


def test_fixture_fallback_covers_first_class_states():
    conn = StateBudgetsConnector(client=offline_client())
    raw = conn.fetch("jur:ng-kd", None, {})
    assert len(raw) == 3  # lagos, kaduna, kano
    assert all(r.payload["fixture"] == "state_budgets_sample.json" for r in raw)
    assert all(r.provenance.origin == "derived" for r in raw)
    states = {r.payload["state"] for r in raw}
    assert states == {"lagos", "kaduna", "kano"}


def test_normalize_emits_state_tier_budget_lines():
    conn = StateBudgetsConnector(client=offline_client())
    out = conn.normalize(conn.fetch("jur:ng-kd", None, {}))
    assert len(out) >= 5
    assert all(r.entity == "budget_line" for r in out)
    assert all(r.data["tier"] == "state" for r in out)
    assert all(r.provenance.origin == "derived" for r in out)
    jurs = {r.data["jurisdiction_id"] for r in out}
    assert {"ng-la", "ng-kd", "ng-kn"} <= jurs
    kaduna = [r for r in out if r.data["state"] == "kaduna"]
    assert kaduna and all(
        r.data["jurisdiction_id"] == "ng-kd" for r in kaduna)
    sample = out[0].data
    assert sample["budget_id"] and len(sample["budget_id"]) <= 96
    assert isinstance(sample["amount_ngn"], float)
    assert sample["appropriation_type"] in ("capital", "recurrent")


def test_live_path_uses_state_portal_and_live_origin():
    fixture = load("state_budgets_sample.json")
    lagos = {"lines": [ln for ln in fixture["lines"]
                       if ln["state"] == "lagos"]}
    conn = StateBudgetsConnector(client=mock_client(
        {"lagosstate.gov.ng": lagos}))
    raw = conn.fetch("jur:ng-la", None, {"states": ["lagos"]})
    assert raw[0].provenance.origin == "live"
    assert raw[0].provenance.url.startswith(
        "https://lagosstate.gov.ng/budget/publications/approved-budget/")
    assert "fixture" not in raw[0].payload
    out = conn.normalize(raw)
    assert len(out) == 3
    assert all(r.data["state"] == "lagos" for r in out)


def test_generic_state_fallback_url():
    assert state_portal_url("kaduna").startswith("https://budget.kdsg.gov.ng")
    assert state_portal_url("enugu") == (
        "https://enugustate.gov.ng/budget/publications")
    conn = StateBudgetsConnector(client=offline_client())
    raw = conn.fetch("jur:ng-en", None, {"states": ["enugu"]})
    # generic state falls back to the fixture, jurisdiction passes through
    assert raw[0].payload["jurisdiction"] == "jur:ng-en"
    assert raw[0].provenance.origin == "derived"


def test_normalize_skips_invalid_lines_and_contract_ok():
    fixture = load("state_budgets_sample.json")
    fixture["lines"].append({
        "state": "lagos", "mda": "", "amount_ngn": 1,
        "fiscal_year": 2025, "appropriation_type": "capital"})
    fixture["lines"].append({
        "state": "lagos", "mda": "Bad MDA", "amount_ngn": 1,
        "fiscal_year": 2025, "appropriation_type": "supplementary"})
    conn = StateBudgetsConnector(client=mock_client(
        {"lagosstate.gov.ng": fixture}))
    raw = conn.fetch("jur:ng-la", None, {"states": ["lagos"]})
    out = conn.normalize(raw)
    assert len(out) == 8  # both bad lines skipped
    contract = conn.contract_check(raw, out)
    assert contract.schema_ok and contract.freshness_ok
    assert contract.completeness_ok


def test_registry_loader_scheduler_wiring():
    assert REGISTRY["state_budgets"] is StateBudgetsConnector
    assert get_connector("state_budgets").name == "state_budgets"
    assert ENTITY_KEYS["budget_line"] == "budgets"
    assert DEFAULT_FIXTURE.exists()
    from app.scheduler import DEFAULT_CADENCE_S
    assert DEFAULT_CADENCE_S["state_budgets"] == 30 * 24 * 3600  # monthly
