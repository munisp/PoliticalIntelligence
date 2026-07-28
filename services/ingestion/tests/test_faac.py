"""faac connector tests — recorded fixtures only, NO network access."""
import json
from pathlib import Path

import httpx

from app.connectors import REGISTRY, get_connector
from app.connectors.faac import FaacConnector, DEFAULT_FIXTURE
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
    conn = FaacConnector(client=offline_client())
    raw = conn.fetch("jur:ng", None, {})
    assert len(raw) == 1
    assert raw[0].payload["fixture"] == "faac_disbursements_sample.json"
    assert len(raw[0].payload["disbursements"]) >= 6


def test_fixture_mode_deterministic():
    conn = FaacConnector(client=offline_client())
    out1 = conn.normalize(conn.fetch("jur:ng", None, {}))
    out2 = conn.normalize(conn.fetch("jur:ng", None, {}))
    assert [r.data for r in out1] == [r.data for r in out2]
    assert len(out1) >= 6


def test_provenance_stamping_derived_origin():
    conn = FaacConnector(client=offline_client())
    raw = conn.fetch("jur:ng", None, {})
    prov = raw[0].provenance
    assert prov.origin == "derived"
    assert prov.source_id == "faac_disbursements"
    assert prov.checksum.startswith("sha256:")
    out = conn.normalize(raw)
    assert all(r.provenance.origin == "derived" for r in out)


def test_entity_shape_budgets_with_faac_tier():
    conn = FaacConnector(client=offline_client())
    out = conn.normalize(conn.fetch("jur:ng", None, {}))
    assert all(r.entity == "budget_line" for r in out)
    for r in out:
        d = r.data
        assert d["tier"] == "faac_allocation"
        assert d["recipient_tier"] in ("federal", "state", "local_government")
        assert d["budget_id"] and len(d["budget_id"]) <= 96
        assert d["jurisdiction_id"] == "jur:ng"
        assert isinstance(d["amount_ngn"], float)
        assert isinstance(d["fiscal_year"], int)
        assert d["appropriation_type"] == "recurrent"
    tiers = {r.data["recipient_tier"] for r in out}
    assert tiers == {"federal", "state", "local_government"}
    contract = conn.contract_check(conn.fetch("jur:ng", None, {}), out)
    assert contract.schema_ok and contract.freshness_ok and contract.completeness_ok


def test_live_path_uses_source_url_and_live_origin():
    fixture = load("faac_disbursements_sample.json")
    conn = FaacConnector(client=mock_client({"faac": fixture}))
    raw = conn.fetch("jur:ng", None, {})
    assert raw[0].provenance.origin == "live"
    assert raw[0].provenance.url.startswith("https://opentreasury.gov.ng/")
    assert "fixture" not in raw[0].payload
    out = conn.normalize(raw)
    assert len(out) == 9  # ecological_fund row skipped (not a gov tier)


def test_invalid_rows_skipped():
    fixture = load("faac_disbursements_sample.json")
    fixture["disbursements"].append(
        {"period": "2024-04", "tier": "federal", "amount_ngn": None})
    fixture["disbursements"].append(
        {"period": "", "tier": "state", "amount_ngn": 1.0})
    conn = FaacConnector(client=mock_client({"faac": fixture}))
    out = conn.normalize(conn.fetch("jur:ng", None, {}))
    assert len(out) == 9
    assert all(r.data["recipient_tier"] != "ecological_fund" for r in out)


def test_registry_and_loader_wiring():
    assert REGISTRY["faac"] is FaacConnector
    assert get_connector("faac").name == "faac"
    assert ENTITY_KEYS["budget_line"] == "budgets"
    assert DEFAULT_FIXTURE.exists()
    rec = CanonicalRecord(
        entity="budget_line",
        data={"budget_id": "x", "tier": "faac_allocation"},
        provenance=get_connector("faac").provenance(None, {}),
    )
    assert rec.entity == "budget_line"


def test_scheduler_cadence_monthly():
    from app.scheduler import DEFAULT_CADENCE_S
    assert DEFAULT_CADENCE_S["faac"] == 30 * 24 * 3600
