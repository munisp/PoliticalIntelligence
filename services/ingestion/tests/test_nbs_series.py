"""nbs_series connector tests — recorded fixtures only, NO network access."""
import json
from pathlib import Path

import httpx

from app.connectors import REGISTRY, get_connector
from app.connectors.nbs_series import NbsSeriesConnector, DEFAULT_FIXTURE
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
    conn = NbsSeriesConnector(client=offline_client())
    raw = conn.fetch("jur:ng", None, {})
    assert len(raw) == 1
    assert raw[0].payload["fixture"] == "nbs_series_sample.json"
    points = sum(len(s["points"]) for s in raw[0].payload["series"])
    assert points >= 6


def test_fixture_mode_deterministic():
    conn = NbsSeriesConnector(client=offline_client())
    out1 = conn.normalize(conn.fetch("jur:ng", None, {}))
    out2 = conn.normalize(conn.fetch("jur:ng", None, {}))
    assert [r.data for r in out1] == [r.data for r in out2]
    assert len(out1) >= 6


def test_provenance_stamping_derived_origin():
    conn = NbsSeriesConnector(client=offline_client())
    raw = conn.fetch("jur:ng", None, {})
    prov = raw[0].provenance
    assert prov.origin == "derived"
    assert prov.source_id == "nbs_indicator_series"
    assert prov.checksum.startswith("sha256:")
    out = conn.normalize(raw)
    assert all(r.provenance.origin == "derived" for r in out)


def test_entity_shape_sector_metrics():
    conn = NbsSeriesConnector(client=offline_client())
    out = conn.normalize(conn.fetch("jur:ng", None, {}))
    assert all(r.entity == "sector_metric" for r in out)
    keys = {r.data["metric_key"] for r in out}
    assert keys == {"cpi_inflation_yoy", "gdp_growth_real", "unemployment_rate"}
    assert all(r.data["indicator_id"].startswith("NBS_") for r in out)
    assert all(r.data["jurisdiction_id"] == "jur:ng" for r in out)
    assert all(isinstance(r.data["value"], float) for r in out)
    contract = conn.contract_check(conn.fetch("jur:ng", None, {}), out)
    assert contract.schema_ok and contract.freshness_ok and contract.completeness_ok


def test_live_path_uses_source_url_and_live_origin():
    fixture = load("nbs_series_sample.json")
    conn = NbsSeriesConnector(client=mock_client({"indicators": fixture}))
    raw = conn.fetch("jur:ng", None, {})
    assert raw[0].provenance.origin == "live"
    assert raw[0].provenance.url.startswith("https://www.nigerianstat.gov.ng/")
    assert "fixture" not in raw[0].payload
    out = conn.normalize(raw)
    assert len(out) == 18  # 3 series x 6 points


def test_null_points_and_unknown_indicators_skipped():
    fixture = load("nbs_series_sample.json")
    fixture["series"][0]["points"].append({"period": "2024-Q3", "value": None})
    fixture["series"].append({"indicator": "NBS_UNKNOWN",
                              "points": [{"period": "2024-07", "value": 1.0}]})
    conn = NbsSeriesConnector(client=mock_client({"indicators": fixture}))
    out = conn.normalize(conn.fetch("jur:ng", None, {}))
    assert len(out) == 18
    assert all(r.data["indicator_id"] != "NBS_UNKNOWN" for r in out)


def test_registry_and_loader_wiring():
    assert REGISTRY["nbs_series"] is NbsSeriesConnector
    assert get_connector("nbs_series").name == "nbs_series"
    assert ENTITY_KEYS["sector_metric"] == "sector_metrics"
    assert DEFAULT_FIXTURE.exists()
    rec = CanonicalRecord(
        entity="sector_metric",
        data={"metric_key": "cpi_inflation_yoy"},
        provenance=get_connector("nbs_series").provenance(None, {}),
    )
    assert rec.entity == "sector_metric"


def test_scheduler_cadence_monthly():
    from app.scheduler import DEFAULT_CADENCE_S
    assert DEFAULT_CADENCE_S["nbs_series"] == 30 * 24 * 3600

def test_distinct_from_nbs_bulletin_connector():
    from app.connectors.nbs_bulletin import NbsBulletinConnector
    assert NbsSeriesConnector.name != NbsBulletinConnector.name
    assert NbsSeriesConnector.source_id != NbsBulletinConnector.source_id
    # bulletin emits data_source metadata; series emits sector_metric values
    conn = NbsSeriesConnector(client=offline_client())
    out = conn.normalize(conn.fetch("jur:ng", None, {}))
    assert all(r.entity == "sector_metric" for r in out)
