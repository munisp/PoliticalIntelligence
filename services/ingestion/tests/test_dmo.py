"""dmo connector tests — recorded fixtures only, NO network access."""
import json
from pathlib import Path

import httpx

from app.connectors import REGISTRY, get_connector
from app.connectors.dmo import DmoConnector, DEFAULT_FIXTURE
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
    conn = DmoConnector(client=offline_client())
    raw = conn.fetch("jur:ng", None, {})
    assert len(raw) == 1
    assert raw[0].payload["fixture"] == "dmo_debt_sample.json"
    points = sum(len(s["points"]) for s in raw[0].payload["series"])
    assert points >= 6


def test_fixture_mode_deterministic():
    conn = DmoConnector(client=offline_client())
    out1 = conn.normalize(conn.fetch("jur:ng", None, {}))
    out2 = conn.normalize(conn.fetch("jur:ng", None, {}))
    assert [r.data for r in out1] == [r.data for r in out2]
    assert len(out1) >= 6


def test_provenance_stamping_derived_origin():
    conn = DmoConnector(client=offline_client())
    raw = conn.fetch("jur:ng", None, {})
    prov = raw[0].provenance
    assert prov.origin == "derived"
    assert prov.source_id == "dmo_debt_statistics"
    assert prov.checksum.startswith("sha256:")
    out = conn.normalize(raw)
    assert all(r.provenance.origin == "derived" for r in out)


def test_entity_shape_sector_metrics():
    conn = DmoConnector(client=offline_client())
    out = conn.normalize(conn.fetch("jur:ng", None, {}))
    assert all(r.entity == "sector_metric" for r in out)
    keys = {r.data["metric_key"] for r in out}
    assert keys == {"total_public_debt_ngn_bn", "domestic_debt_ngn_bn",
                    "external_debt_usd_mn", "debt_service_ngn_bn"}
    assert all(r.data["indicator_id"].startswith("DMO_") for r in out)
    assert all(r.data["jurisdiction_id"] == "jur:ng" for r in out)
    assert all(isinstance(r.data["value"], float) for r in out)
    contract = conn.contract_check(conn.fetch("jur:ng", None, {}), out)
    assert contract.schema_ok and contract.freshness_ok and contract.completeness_ok


def test_live_path_uses_source_url_and_live_origin():
    fixture = load("dmo_debt_sample.json")
    conn = DmoConnector(client=mock_client({"debt-statistics": fixture}))
    raw = conn.fetch("jur:ng", None, {})
    assert raw[0].provenance.origin == "live"
    assert raw[0].provenance.url.startswith("https://www.dmo.gov.ng/")
    assert "fixture" not in raw[0].payload
    out = conn.normalize(raw)
    assert len(out) == 24  # 4 series x 6 points


def test_null_points_and_unknown_indicators_skipped():
    fixture = load("dmo_debt_sample.json")
    fixture["series"][0]["points"].append({"period": "2024-Q3", "value": None})
    fixture["series"].append({"indicator": "DMO_UNKNOWN",
                              "points": [{"period": "2024-Q3", "value": 1.0}]})
    conn = DmoConnector(client=mock_client({"debt-statistics": fixture}))
    out = conn.normalize(conn.fetch("jur:ng", None, {}))
    assert len(out) == 24
    assert all(r.data["indicator_id"] != "DMO_UNKNOWN" for r in out)


def test_registry_and_loader_wiring():
    assert REGISTRY["dmo"] is DmoConnector
    assert get_connector("dmo").name == "dmo"
    assert ENTITY_KEYS["sector_metric"] == "sector_metrics"
    assert DEFAULT_FIXTURE.exists()
    rec = CanonicalRecord(
        entity="sector_metric",
        data={"metric_key": "total_public_debt_ngn_bn"},
        provenance=get_connector("dmo").provenance(None, {}),
    )
    assert rec.entity == "sector_metric"


def test_scheduler_cadence_monthly():
    from app.scheduler import DEFAULT_CADENCE_S
    assert DEFAULT_CADENCE_S["dmo"] == 30 * 24 * 3600
