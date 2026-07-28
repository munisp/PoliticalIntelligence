"""nass_bills connector tests — recorded fixtures only, NO network access."""
import json
from pathlib import Path

import httpx

from app.connectors import REGISTRY, get_connector
from app.connectors.nass_bills import NassBillsConnector, DEFAULT_FIXTURE
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
    conn = NassBillsConnector(client=offline_client())
    raw = conn.fetch("jur:ng", None, {})
    assert len(raw) == 1
    assert raw[0].payload["fixture"] == "nass_bills_sample.json"
    assert len(raw[0].payload["bills"]) >= 6


def test_fixture_mode_deterministic():
    conn = NassBillsConnector(client=offline_client())
    out1 = conn.normalize(conn.fetch("jur:ng", None, {}))
    out2 = conn.normalize(conn.fetch("jur:ng", None, {}))
    assert [r.data for r in out1] == [r.data for r in out2]
    assert len(out1) >= 6


def test_provenance_stamping_derived_origin():
    conn = NassBillsConnector(client=offline_client())
    raw = conn.fetch("jur:ng", None, {})
    prov = raw[0].provenance
    assert prov.origin == "derived"
    assert prov.source_id == "nass_bills_tracker"
    assert prov.checksum.startswith("sha256:")
    out = conn.normalize(raw)
    assert all(r.provenance.origin == "derived" for r in out)


def test_entity_shape_matches_loader_schema():
    conn = NassBillsConnector(client=offline_client())
    raw = conn.fetch("jur:ng", None, {})
    out = conn.normalize(raw)
    assert all(r.entity == "bill_document" for r in out)
    stages = set()
    for r in out:
        d = r.data
        assert d["document_id"] and len(d["document_id"]) <= 64
        assert d["document_type"] == "bill"
        assert d["title"]
        meta = d["metadata"]
        assert meta["chamber"] in ("Senate", "House")
        assert meta["stage"] in (
            "first_reading", "second_reading", "committee",
            "third_reading", "passed", "assented",
        )
        assert meta["sponsor"]
        stages.add(meta["stage"])
    assert len(stages) >= 3  # fixture spans multiple legislative stages
    contract = conn.contract_check(raw, out)
    assert contract.schema_ok and contract.freshness_ok and contract.completeness_ok


def test_live_path_uses_source_url_and_live_origin():
    fixture = load("nass_bills_sample.json")
    conn = NassBillsConnector(client=mock_client({"/bills": fixture}))
    raw = conn.fetch("jur:ng", None, {})
    assert raw[0].provenance.origin == "live"
    assert raw[0].provenance.url == "https://nass.gov.ng/bills"
    assert "fixture" not in raw[0].payload
    out = conn.normalize(raw)
    assert len(out) >= 6


def test_normalize_skips_invalid_bills():
    fixture = load("nass_bills_sample.json")
    fixture["bills"].append({
        "title": "", "chamber": "Senate", "stage": "passed",
    })
    fixture["bills"].append({
        "title": "Phantom Bill", "chamber": "Senate", "stage": "vetoed",
    })
    conn = NassBillsConnector(client=mock_client({"/bills": fixture}))
    out = conn.normalize(conn.fetch("jur:ng", None, {}))
    assert len(out) == 7  # both bad bills skipped


def test_registry_and_loader_wiring():
    assert REGISTRY["nass_bills"] is NassBillsConnector
    assert get_connector("nass_bills").name == "nass_bills"
    assert ENTITY_KEYS["bill_document"] == "policy_documents"
    assert DEFAULT_FIXTURE.exists()
    rec = CanonicalRecord(
        entity="bill_document",
        data={"document_id": "x"},
        provenance=get_connector("nass_bills").provenance(None, {}),
    )
    assert rec.entity == "bill_document"


def test_scheduler_cadence_weekly():
    from app.scheduler import DEFAULT_CADENCE_S
    assert DEFAULT_CADENCE_S["nass_bills"] == 7 * 24 * 3600
