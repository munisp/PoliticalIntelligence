"""budget_office connector tests — recorded fixtures only, NO network access."""
import json
from pathlib import Path

import httpx
import pytest

from app.connectors import REGISTRY, get_connector
from app.connectors.budget_office import (
    BudgetOfficeConnector,
    DEFAULT_FIXTURE,
)
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


# ---------------------------------------------------------------------------
# Fixture fallback (offline determinism)
# ---------------------------------------------------------------------------
def test_fixture_fallback_triggers_when_source_unreachable():
    conn = BudgetOfficeConnector(client=offline_client())
    raw = conn.fetch("jur:ng", None, {})
    assert len(raw) == 1
    assert raw[0].payload["fixture"] == "budget_office_2025_sample.json"
    assert len(raw[0].payload["lines"]) >= 8


def test_fixture_mode_deterministic():
    conn = BudgetOfficeConnector(client=offline_client())
    out1 = conn.normalize(conn.fetch("jur:ng", None, {}))
    out2 = conn.normalize(conn.fetch("jur:ng", None, {}))
    assert [r.data for r in out1] == [r.data for r in out2]
    assert len(out1) >= 8


def test_provenance_stamping_derived_origin():
    conn = BudgetOfficeConnector(client=offline_client())
    raw = conn.fetch("jur:ng", None, {})
    prov = raw[0].provenance
    assert prov.origin == "derived"
    assert prov.source_id == "budget_office_federation"
    assert prov.checksum.startswith("sha256:")
    out = conn.normalize(raw)
    assert all(r.provenance.origin == "derived" for r in out)


def test_entity_shape_matches_loader_schema():
    conn = BudgetOfficeConnector(client=offline_client())
    out = conn.normalize(conn.fetch("jur:ng", None, {}))
    assert all(r.entity == "budget_line" for r in out)
    # CanonicalRecord validation happens at construction; check budgets columns.
    for r in out:
        d = r.data
        assert d["budget_id"] and len(d["budget_id"]) <= 96
        assert d["jurisdiction_id"] == "jur:ng"
        assert isinstance(d["fiscal_year"], int)
        assert isinstance(d["amount_ngn"], float)
        assert d["appropriation_type"] in ("capital", "recurrent")
        assert d["mda"]
    contract = conn.contract_check(conn.fetch("jur:ng", None, {}), out)
    assert contract.schema_ok and contract.freshness_ok and contract.completeness_ok


def test_live_path_uses_source_url_and_live_origin():
    fixture = load("budget_office_2025_sample.json")
    conn = BudgetOfficeConnector(client=mock_client(
        {"appropriation-act": fixture}))
    raw = conn.fetch("jur:ng", None, {})
    assert raw[0].provenance.origin == "live"
    assert raw[0].provenance.url.startswith(
        "https://budgetoffice.gov.ng/publications/appropriation-act/")
    assert "fixture" not in raw[0].payload
    out = conn.normalize(raw)
    assert len(out) >= 8
    assert all(r.entity == "budget_line" for r in out)


def test_normalize_skips_invalid_lines():
    fixture = load("budget_office_2025_sample.json")
    fixture["lines"].append({
        "mda": "", "program_code": "X", "amount_ngn": 1,
        "fiscal_year": 2025, "appropriation_type": "capital",
    })
    fixture["lines"].append({
        "mda": "Bad MDA", "program_code": "Y", "amount_ngn": 1,
        "fiscal_year": 2025, "appropriation_type": "supplementary",
    })
    conn = BudgetOfficeConnector(client=mock_client(
        {"appropriation-act": fixture}))
    out = conn.normalize(conn.fetch("jur:ng", None, {}))
    assert len(out) == 9  # both bad lines skipped


def test_registry_and_loader_wiring():
    assert REGISTRY["budget_office"] is BudgetOfficeConnector
    assert get_connector("budget_office").name == "budget_office"
    assert ENTITY_KEYS["budget_line"] == "budgets"
    assert DEFAULT_FIXTURE.exists()
    # entity literal accepted by the canonical schema
    rec = CanonicalRecord(
        entity="budget_line",
        data={"budget_id": "x"},
        provenance=get_connector("budget_office").provenance(None, {}),
    )
    assert rec.entity == "budget_line"


def test_scheduler_cadence_quarterly():
    from app.scheduler import DEFAULT_CADENCE_S
    assert DEFAULT_CADENCE_S["budget_office"] == 90 * 24 * 3600
