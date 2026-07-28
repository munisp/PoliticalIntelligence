"""gazettes connector tests — recorded fixtures only, NO network access."""
import json
from pathlib import Path

import httpx

from app.connectors import REGISTRY, get_connector
from app.connectors.gazettes import GazettesConnector, DEFAULT_FIXTURE
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
    conn = GazettesConnector(client=offline_client())
    raw = conn.fetch("jur:ng", None, {})
    assert len(raw) == 1
    assert raw[0].payload["fixture"] == "gazettes_sample.json"
    assert len(raw[0].payload["gazettes"]) >= 6


def test_fixture_mode_deterministic():
    conn = GazettesConnector(client=offline_client())
    out1 = conn.normalize(conn.fetch("jur:ng", None, {}))
    out2 = conn.normalize(conn.fetch("jur:ng", None, {}))
    assert [r.data for r in out1] == [r.data for r in out2]
    assert len(out1) >= 6


def test_provenance_stamping_derived_origin():
    conn = GazettesConnector(client=offline_client())
    raw = conn.fetch("jur:ng", None, {})
    prov = raw[0].provenance
    assert prov.origin == "derived"
    assert prov.source_id == "official_gazettes"
    assert prov.checksum.startswith("sha256:")
    out = conn.normalize(raw)
    assert all(r.provenance.origin == "derived" for r in out)


def test_entity_shape_gazette_documents():
    conn = GazettesConnector(client=offline_client())
    out = conn.normalize(conn.fetch("jur:ng", None, {}))
    assert all(r.entity == "policy_document" for r in out)
    assert all(r.data["document_type"] == "gazette" for r in out)
    levels = {r.data["metadata"]["level"] for r in out}
    assert levels == {"federal", "state"}
    for r in out:
        d = r.data
        assert d["document_id"] and len(d["document_id"]) <= 64
        assert d["jurisdiction_id"] == "jur:ng"
        assert d["metadata"]["gazette_no"]
        assert len(d["hash"]) == 64
    lagos = next(r for r in out
                 if "Lagos" in r.data["title"])
    assert lagos.data["metadata"]["state"] == "Lagos"
    assert lagos.data["metadata"]["subject_sectors"] == ["energy"]
    contract = conn.contract_check(conn.fetch("jur:ng", None, {}), out)
    assert contract.schema_ok and contract.freshness_ok and contract.completeness_ok


def test_live_path_uses_source_url_and_live_origin():
    fixture = load("gazettes_sample.json")
    conn = GazettesConnector(client=mock_client({"gazettes": fixture}))
    raw = conn.fetch("jur:ng", None, {})
    assert raw[0].provenance.origin == "live"
    assert raw[0].provenance.url.startswith("https://lawnigeria.com/")
    assert "fixture" not in raw[0].payload
    out = conn.normalize(raw)
    assert len(out) == 6  # row missing gazette_no skipped


def test_invalid_rows_skipped():
    fixture = load("gazettes_sample.json")
    fixture["gazettes"].append(
        {"title": "", "level": "federal", "gazette_no": "No. 1"})
    fixture["gazettes"].append(
        {"title": "Bad level", "level": "municipal", "gazette_no": "No. 2"})
    conn = GazettesConnector(client=mock_client({"gazettes": fixture}))
    out = conn.normalize(conn.fetch("jur:ng", None, {}))
    assert len(out) == 6
    assert all(r.data["metadata"]["level"] in ("federal", "state") for r in out)


def test_registry_and_loader_wiring():
    assert REGISTRY["gazettes"] is GazettesConnector
    assert get_connector("gazettes").name == "gazettes"
    assert ENTITY_KEYS["policy_document"] == "policy_documents"
    assert DEFAULT_FIXTURE.exists()
    rec = CanonicalRecord(
        entity="policy_document",
        data={"document_id": "x", "document_type": "gazette"},
        provenance=get_connector("gazettes").provenance(None, {}),
    )
    assert rec.entity == "policy_document"


def test_scheduler_cadence_weekly():
    from app.scheduler import DEFAULT_CADENCE_S
    assert DEFAULT_CADENCE_S["gazettes"] == 7 * 24 * 3600
