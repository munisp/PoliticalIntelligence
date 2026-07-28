"""bpp connector tests — recorded fixtures only, NO network access."""
import json
from pathlib import Path

import httpx

from app.connectors import REGISTRY, get_connector
from app.connectors.bpp import BppConnector, DEFAULT_FIXTURE
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
    conn = BppConnector(client=offline_client())
    raw = conn.fetch("jur:ng", None, {})
    assert raw[0].payload["fixture"] == "bpp_awards_sample.json"
    assert raw[0].provenance.origin == "derived"
    out = conn.normalize(raw)
    assert len(out) == 6
    assert all(r.entity == "procurement_record" for r in out)
    assert all(r.data["tier"] == "federal" for r in out)


def test_normalize_fields():
    conn = BppConnector(client=offline_client())
    out = conn.normalize(conn.fetch("jur:ng", None, {}))
    first = out[0].data
    assert first["ocid"] == "ocds-bpp-fgn-2024-0001"
    assert first["nocopo_no"] == "NOCOPO/2024/FMH/0112"
    assert first["buyer"] == "Federal Ministry of Works"
    assert first["supplier"] == "Julius Berger Nigeria Plc"
    assert first["value_ngn"] == 38500000000
    assert first["award_date"] == "2024-03-11"


def test_live_path_live_origin():
    fixture = load("bpp_awards_sample.json")
    conn = BppConnector(client=mock_client({"nocopo/awards": fixture}))
    raw = conn.fetch("jur:ng", None, {})
    assert raw[0].provenance.origin == "live"
    assert raw[0].provenance.url.startswith("https://bpp.gov.ng/nocopo/awards")
    assert "fixture" not in raw[0].payload
    out = conn.normalize(raw)
    assert len(out) == 6


def test_missing_ocid_skipped_and_contract():
    fixture = load("bpp_awards_sample.json")
    fixture["records"].append({"title": "no identifier at all"})
    conn = BppConnector(client=mock_client({"nocopo/awards": fixture}))
    raw = conn.fetch("jur:ng", None, {})
    out = conn.normalize(raw)
    assert len(out) == 6
    contract = conn.contract_check(raw, out)
    assert contract.schema_ok and contract.freshness_ok
    assert contract.completeness_ok


def test_wiring():
    assert REGISTRY["bpp"] is BppConnector
    assert get_connector("bpp").name == "bpp"
    assert ENTITY_KEYS["procurement_record"] == "procurement_records"
    assert DEFAULT_FIXTURE.exists()
    from app.scheduler import DEFAULT_CADENCE_S
    assert DEFAULT_CADENCE_S["bpp"] == 30 * 24 * 3600
