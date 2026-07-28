"""smedan connector tests — recorded fixtures only, NO network access."""
import json
from pathlib import Path

import httpx

from app.connectors import REGISTRY, get_connector
from app.connectors.smedan import SmedanConnector, DEFAULT_FIXTURE
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
    conn = SmedanConnector(client=offline_client())
    raw = conn.fetch("jur:ng", None, {})
    assert raw[0].payload["fixture"] == "smedan_survey_sample.json"
    assert raw[0].provenance.origin == "derived"
    out = conn.normalize(raw)
    assert len(out) >= 5
    assert all(r.entity == "sector_metric" for r in out)
    assert all(r.provenance.origin == "derived" for r in out)


def test_smedan_metric_keys_and_values():
    conn = SmedanConnector(client=offline_client())
    out = conn.normalize(conn.fetch("jur:ng", None, {}))
    assert all(r.data["metric_key"].startswith("SMEDAN_") for r in out)
    nat = [r for r in out if r.data["period"] == "2021"
           and r.data["metric_key"] == "SMEDAN_MSME_COUNT"
           and not r.data.get("state")]
    assert nat[0].data["value"] == 39654654
    assert nat[0].data["jurisdiction_id"] == "jur:ng"
    kd = [r for r in out if r.data.get("state") == "Kaduna"
          and r.data["metric_key"] == "SMEDAN_MSME_EMPLOYMENT"]
    assert kd[0].data["jurisdiction_id"] == "ng-kd"
    assert kd[0].data["value"] == 1862000


def test_live_path_live_origin():
    fixture = load("smedan_survey_sample.json")
    conn = SmedanConnector(client=mock_client({"msme-survey": fixture}))
    raw = conn.fetch("jur:ng", None, {})
    assert raw[0].provenance.origin == "live"
    assert raw[0].provenance.url.startswith(
        "https://smedan.gov.ng/msme-survey/highlights")
    out = conn.normalize(raw)
    assert len(out) >= 5


def test_rows_without_period_skipped_and_contract():
    fixture = load("smedan_survey_sample.json")
    fixture["rows"].append({"scope": "national", "msme_count": 1})
    conn = SmedanConnector(client=mock_client({"msme-survey": fixture}))
    raw = conn.fetch("jur:ng", None, {})
    out = conn.normalize(raw)
    assert all(r.data["period"] for r in out)
    contract = conn.contract_check(raw, out)
    assert contract.schema_ok and contract.freshness_ok
    assert contract.completeness_ok


def test_wiring():
    assert REGISTRY["smedan"] is SmedanConnector
    assert get_connector("smedan").name == "smedan"
    assert ENTITY_KEYS["sector_metric"] == "sector_metrics"
    assert DEFAULT_FIXTURE.exists()
    from app.scheduler import DEFAULT_CADENCE_S
    assert DEFAULT_CADENCE_S["smedan"] == 30 * 24 * 3600
