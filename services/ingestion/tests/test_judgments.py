"""judgments connector tests — recorded fixtures only, NO network access."""
import json
from pathlib import Path

import httpx

from app.connectors import REGISTRY, get_connector
from app.connectors.judgments import JudgmentsConnector, DEFAULT_FIXTURE
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
    conn = JudgmentsConnector(client=offline_client())
    raw = conn.fetch("jur:ng", None, {})
    assert len(raw) == 1
    assert raw[0].payload["fixture"] == "judgments_sample.json"
    assert len(raw[0].payload["judgments"]) >= 6


def test_fixture_mode_deterministic():
    conn = JudgmentsConnector(client=offline_client())
    out1 = conn.normalize(conn.fetch("jur:ng", None, {}))
    out2 = conn.normalize(conn.fetch("jur:ng", None, {}))
    assert [r.data for r in out1] == [r.data for r in out2]
    assert len(out1) >= 6


def test_provenance_stamping_derived_origin():
    conn = JudgmentsConnector(client=offline_client())
    raw = conn.fetch("jur:ng", None, {})
    prov = raw[0].provenance
    assert prov.origin == "derived"
    assert prov.source_id == "nigerialii_judgments"
    assert prov.checksum.startswith("sha256:")
    out = conn.normalize(raw)
    assert all(r.provenance.origin == "derived" for r in out)


def test_entity_shape_judgment_documents():
    conn = JudgmentsConnector(client=offline_client())
    out = conn.normalize(conn.fetch("jur:ng", None, {}))
    assert all(r.entity == "policy_document" for r in out)
    assert all(r.data["document_type"] == "judgment" for r in out)
    for r in out:
        d = r.data
        assert d["document_id"] and len(d["document_id"]) <= 64
        assert d["jurisdiction_id"] == "jur:ng"
        assert d["metadata"]["court"]
        assert d["metadata"]["citation"]
        assert isinstance(d["metadata"]["subject_sectors"], list)
        assert len(d["hash"]) == 64
    vat = next(r for r in out if "VAT" in r.data["title"])
    assert vat.data["metadata"]["court"].startswith("Federal High Court")
    assert vat.data["metadata"]["subject_sectors"] == ["finance", "taxation"]
    courts = {r.data["metadata"]["court"] for r in out}
    assert "Supreme Court of Nigeria" in courts
    contract = conn.contract_check(conn.fetch("jur:ng", None, {}), out)
    assert contract.schema_ok and contract.freshness_ok and contract.completeness_ok


def test_live_path_uses_source_url_and_live_origin():
    fixture = load("judgments_sample.json")
    conn = JudgmentsConnector(client=mock_client({"judgments": fixture}))
    raw = conn.fetch("jur:ng", None, {})
    assert raw[0].provenance.origin == "live"
    assert raw[0].provenance.url.startswith("https://nigerialii.org/")
    assert "fixture" not in raw[0].payload
    out = conn.normalize(raw)
    assert len(out) == 6  # row missing citation skipped


def test_invalid_rows_skipped():
    fixture = load("judgments_sample.json")
    fixture["judgments"].append(
        {"title": "", "court": "Supreme Court of Nigeria",
         "citation": "(2024) 1 NWLR 1"})
    fixture["judgments"].append(
        {"title": "No court", "court": "", "citation": "(2024) 2 NWLR 2"})
    conn = JudgmentsConnector(client=mock_client({"judgments": fixture}))
    out = conn.normalize(conn.fetch("jur:ng", None, {}))
    assert len(out) == 6
    assert all(r.data["metadata"]["court"] for r in out)


def test_registry_and_loader_wiring():
    assert REGISTRY["judgments"] is JudgmentsConnector
    assert get_connector("judgments").name == "judgments"
    assert ENTITY_KEYS["policy_document"] == "policy_documents"
    assert DEFAULT_FIXTURE.exists()
    rec = CanonicalRecord(
        entity="policy_document",
        data={"document_id": "x", "document_type": "judgment"},
        provenance=get_connector("judgments").provenance(None, {}),
    )
    assert rec.entity == "policy_document"


def test_scheduler_cadence_weekly():
    from app.scheduler import DEFAULT_CADENCE_S
    assert DEFAULT_CADENCE_S["judgments"] == 7 * 24 * 3600
