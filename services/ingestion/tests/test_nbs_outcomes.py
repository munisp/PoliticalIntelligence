"""NBS outcomes connector tests — recorded fixture + mock transport, NO
network access (feature G2)."""
import json
from pathlib import Path

import httpx

from app.connectors import REGISTRY, get_connector
from app.connectors.nbs_outcomes import NbsOutcomesConnector

FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str):
    return json.loads((FIXTURES / name).read_text())


def mock_client(routes: dict[str, object]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        for key, body in routes.items():
            if key in str(request.url):
                status, payload = (200, body) if not isinstance(body, tuple) else body
                if isinstance(payload, (dict, list)):
                    return httpx.Response(status, json=payload)
                return httpx.Response(status, content=str(payload))
        return httpx.Response(404, json={"error": "not mocked"})
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_fetch_normalize_live_extract():
    conn = NbsOutcomesConnector(client=mock_client(
        {"nigerianstat.gov.ng": load("nbs_labour_force.json")}))
    raw = conn.fetch("jur:ng", None, {})
    assert len(raw) == 1
    prov = raw[0].provenance
    assert prov.origin == "live"
    assert prov.source_id == "nbs_labour_force"
    assert prov.checksum.startswith("sha256:")
    out = conn.normalize(raw)
    # 8 + 8 + 3 observations; the null 2025-03 unemployment value is skipped.
    assert len(out) == 19
    assert all(r.entity == "outcome_observation" for r in out)
    unemp = [r for r in out if r.data["indicator_code"] == "UNEMPLOYMENT_RATE"]
    assert len(unemp) == 8
    latest = max(unemp, key=lambda r: r.data["period"])
    assert latest.data["period"] == "2024-12"
    assert latest.data["value"] == 4.8
    assert latest.data["frequency"] == "quarterly"
    assert latest.data["jurisdiction_id"] == "jur:ng"
    contract = conn.contract_check(raw, out)
    assert contract.schema_ok and contract.freshness_ok and contract.completeness_ok


def test_offline_fixture_fallback_is_provenance_stamped():
    """Unreachable live endpoint -> recorded fixture, origin='derived'."""
    conn = NbsOutcomesConnector(client=mock_client({}))  # 404 everywhere
    raw = conn.fetch("jur:ng", None, {})
    assert raw[0].provenance.origin == "derived"
    out = conn.normalize(raw)
    assert len(out) == 19  # same as live: deterministic fallback


def test_fixture_fallback_disabled_raises():
    import pytest
    from app.errors import ServiceError
    conn = NbsOutcomesConnector(client=mock_client({}))
    with pytest.raises(ServiceError):
        conn.fetch("jur:ng", None, {"allow_fixture_fallback": False})


def test_normalize_is_deterministic():
    conn = NbsOutcomesConnector(client=mock_client(
        {"nigerianstat.gov.ng": load("nbs_labour_force.json")}))
    raw = conn.fetch("jur:ng", None, {})
    first = [r.data for r in conn.normalize(raw)]
    second = [r.data for r in conn.normalize(raw)]
    assert first == second


def test_registry_includes_nbs_outcomes():
    assert "nbs_outcomes" in REGISTRY
    assert get_connector("nbs_outcomes").name == "nbs_outcomes"
