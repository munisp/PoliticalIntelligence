"""afdb connector tests — recorded fixtures only, NO network access."""
import json
from pathlib import Path

import httpx

from app.connectors import REGISTRY, get_connector
from app.connectors.afdb import AfdbConnector, DEFAULT_FIXTURE
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


def test_fixture_fallback_emits_budgets_and_evidence():
    conn = AfdbConnector(client=offline_client())
    raw = conn.fetch("jur:ng", None, {})
    assert raw[0].provenance.origin == "derived"
    out = conn.normalize(raw)
    budgets = [r for r in out if r.entity == "budget_line"]
    evidence = [r for r in out if r.entity == "evidence_source"]
    assert len(budgets) == 5 and len(evidence) == 5
    assert all(b.data["tier"] == "development_partner" for b in budgets)
    assert all(b.data["partner"] == "African Development Bank" for b in budgets)


def test_usd_conversion_and_jurisdiction_routing():
    conn = AfdbConnector(client=offline_client())
    out = conn.normalize(conn.fetch("jur:ng", None, {}))
    budgets = {b.data["budget_id"]: b.data for b in out
               if b.entity == "budget_line"}
    sapz = budgets["afdb:P-NG-DB0-001"]
    assert sapz["amount_ngn"] == 520000000 * 460.0
    assert sapz["jurisdiction_id"] == "ng-kd"
    assert sapz["fiscal_year"] == 2022
    ngn_row = budgets["afdb:P-NG-HA0-005"]
    assert ngn_row["amount_ngn"] == 31200000000  # NGN published as-is


def test_evidence_shape_and_linkage():
    conn = AfdbConnector(client=offline_client())
    out = conn.normalize(conn.fetch("jur:ng", None, {}))
    ev = [r for r in out if r.entity == "evidence_source"]
    first = ev[0].data
    assert first["evidence_source_id"].startswith("afdb:evidence:")
    assert "African Development Bank" in first["citation"]
    assert first["content_excerpt"]
    assert first["linked_entity_ids"]["budget_ids"][0].startswith("afdb:")


def test_live_path_and_invalid_rows_skipped():
    fixture = load("afdb_projects_sample.json")
    fixture["projects"].append({"project_id": "", "title": "no id"})
    conn = AfdbConnector(client=mock_client({"/query/NGA": fixture}))
    raw = conn.fetch("jur:ng", None, {})
    assert raw[0].provenance.origin == "live"
    assert raw[0].provenance.url.endswith("/query/NGA")
    out = conn.normalize(raw)
    assert len([r for r in out if r.entity == "budget_line"]) == 5
    contract = conn.contract_check(
        raw, [r for r in out if r.entity == "budget_line"])
    assert contract.schema_ok and contract.completeness_ok


def test_wiring_and_entity_literal():
    assert REGISTRY["afdb"] is AfdbConnector
    assert get_connector("afdb").name == "afdb"
    assert ENTITY_KEYS["budget_line"] == "budgets"
    assert ENTITY_KEYS["evidence_source"] == "evidence_sources"
    assert DEFAULT_FIXTURE.exists()
    rec = CanonicalRecord(
        entity="evidence_source",
        data={"evidence_source_id": "x"},
        provenance=get_connector("afdb").provenance(None, {}),
    )
    assert rec.entity == "evidence_source"
    from app.scheduler import DEFAULT_CADENCE_S
    assert DEFAULT_CADENCE_S["afdb"] == 30 * 24 * 3600
