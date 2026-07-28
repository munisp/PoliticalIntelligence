"""state_assembly_bills connector tests — recorded fixtures only, NO network."""
import json
from pathlib import Path

import httpx

from app.connectors import REGISTRY, get_connector
from app.connectors.state_assembly_bills import (
    DEFAULT_FIXTURE,
    StateAssemblyBillsConnector,
    state_assembly_url,
)
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


def test_fixture_fallback_and_derived_origin():
    conn = StateAssemblyBillsConnector(client=offline_client())
    raw = conn.fetch("jur:ng-kd", None, {})
    assert len(raw) == 3
    assert all(r.provenance.origin == "derived" for r in raw)
    out = conn.normalize(raw)
    assert len(out) == 6
    assert all(r.entity == "bill_document" for r in out)
    assert all(r.data["document_type"] == "bill" for r in out)


def test_metadata_carries_state_chamber_stage():
    conn = StateAssemblyBillsConnector(client=offline_client())
    out = conn.normalize(conn.fetch("jur:ng-kd", None, {}))
    for r in out:
        md = r.data["metadata"]
        assert md["state"] in ("lagos", "kaduna", "kano")
        assert md["chamber"] == "House of Assembly"
        assert md["stage"] in (
            "first_reading", "second_reading", "committee",
            "third_reading", "passed", "assented")
    kd = [r for r in out if r.data["metadata"]["state"] == "kaduna"]
    assert kd and all(r.data["jurisdiction_id"] == "ng-kd" for r in kd)
    assert kd[0].data["document_id"].startswith(
        "state_assembly_bills_tracker:kaduna:")


def test_live_path_live_origin_and_state_filter():
    fixture = load("state_assembly_bills_sample.json")
    lagos = {"bills": [b for b in fixture["bills"] if b["state"] == "lagos"]}
    conn = StateAssemblyBillsConnector(client=mock_client(
        {"lagoshouseofassembly.gov.ng": lagos}))
    raw = conn.fetch("jur:ng-la", None, {"states": ["lagos"]})
    assert raw[0].provenance.origin == "live"
    assert raw[0].provenance.url == (
        "https://lagoshouseofassembly.gov.ng/bills")
    out = conn.normalize(raw)
    assert len(out) == 2
    assert all(r.data["metadata"]["state"] == "lagos" for r in out)


def test_invalid_stage_and_empty_title_skipped():
    fixture = load("state_assembly_bills_sample.json")
    fixture["bills"].append({
        "state": "kaduna", "title": "", "stage": "passed"})
    fixture["bills"].append({
        "state": "kaduna", "title": "Bad Stage Bill", "stage": "vetoed"})
    conn = StateAssemblyBillsConnector(client=mock_client(
        {"kdsha.kdsg.gov.ng": fixture}))
    raw = conn.fetch("jur:ng-kd", None, {"states": ["kaduna"]})
    out = conn.normalize(raw)
    assert len(out) == 6  # both bad bills skipped
    contract = conn.contract_check(raw, out)
    assert contract.schema_ok and contract.completeness_ok


def test_generic_state_url_and_wiring():
    assert state_assembly_url("kaduna") == "https://kdsha.kdsg.gov.ng/bills"
    assert state_assembly_url("rivers") == (
        "https://riversstate.gov.ng/house-of-assembly/bills")
    assert REGISTRY["state_assembly_bills"] is StateAssemblyBillsConnector
    assert get_connector("state_assembly_bills").name == "state_assembly_bills"
    assert ENTITY_KEYS["bill_document"] == "policy_documents"
    assert DEFAULT_FIXTURE.exists()
    from app.scheduler import DEFAULT_CADENCE_S
    assert DEFAULT_CADENCE_S["state_assembly_bills"] == 7 * 24 * 3600  # weekly
