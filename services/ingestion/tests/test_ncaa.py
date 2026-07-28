"""ncaa connector tests — recorded fixtures only, NO network access."""
from app.connectors import REGISTRY, get_connector
from app.connectors.ncaa import NcaaConnector
from app.loader import ENTITY_KEYS
from regulator_kit import load, mock_client, offline_client

FIXTURE = "ncaa_regs.json"


def test_fixture_fallback_triggers_when_source_unreachable():
    conn = NcaaConnector(client=offline_client())
    raw = conn.fetch("jur:ng", None, {})
    assert len(raw) == 1
    assert raw[0].payload["fixture"] == FIXTURE
    assert len(raw[0].payload["instruments"]) >= 5


def test_fixture_mode_deterministic():
    conn = NcaaConnector(client=offline_client())
    out1 = conn.normalize(conn.fetch("jur:ng", None, {}))
    out2 = conn.normalize(conn.fetch("jur:ng", None, {}))
    assert [r.data for r in out1] == [r.data for r in out2]


def test_provenance_stamping_derived_origin():
    conn = NcaaConnector(client=offline_client())
    raw = conn.fetch("jur:ng", None, {})
    prov = raw[0].provenance
    assert prov.origin == "derived"
    assert prov.source_id == "ncaa_regulations"
    assert prov.checksum.startswith("sha256:")
    out = conn.normalize(raw)
    assert all(r.provenance.origin == "derived" for r in out)


def test_entity_shape_matches_loader_schema():
    conn = NcaaConnector(client=offline_client())
    raw = conn.fetch("jur:ng", None, {})
    out = conn.normalize(raw)
    docs = [r for r in out if r.entity == "bill_document"]
    assert len(docs) >= 5
    for r in docs:
        d = r.data
        assert d["document_id"] and len(d["document_id"]) <= 64
        assert d["document_type"] == "regulation"
        assert d["title"]
        meta = d["metadata"]
        assert meta["regulator"] == "NCAA"
        assert meta["instrument_type"]
        assert isinstance(meta["subject_sectors"], list) and meta["subject_sectors"]
    contract = conn.contract_check(raw, out)
    assert contract.schema_ok and contract.freshness_ok and contract.completeness_ok


def test_quantitative_instrument_emits_sector_metric():
    conn = NcaaConnector(client=offline_client())
    out = conn.normalize(conn.fetch("jur:ng", None, {}))
    metrics = [r for r in out if r.entity == "sector_metric"]
    assert metrics
    m = metrics[0].data
    assert m["metric_key"] == "registered_rpas_operators"
    assert m["sector_code"] == "aviation"
    assert isinstance(m["value"], float)


def test_live_path_uses_source_url_and_live_origin():
    fixture = load(FIXTURE)
    conn = NcaaConnector(client=mock_client({"/regulations": fixture}))
    raw = conn.fetch("jur:ng", None, {})
    assert raw[0].provenance.origin == "live"
    assert raw[0].provenance.url == "https://ncaa.gov.ng/regulations"
    assert "fixture" not in raw[0].payload
    out = conn.normalize(raw)
    assert len([r for r in out if r.entity == "bill_document"]) >= 5


def test_normalize_skips_invalid_instruments():
    fixture = load(FIXTURE)
    fixture["instruments"].append({"title": "", "instrument_type": "guidelines"})
    fixture["instruments"].append({"title": "No type instrument"})
    conn = NcaaConnector(client=mock_client({"/regulations": fixture}))
    out = conn.normalize(conn.fetch("jur:ng", None, {}))
    assert len([r for r in out if r.entity == "bill_document"]) == 6


def test_registry_loader_and_scheduler_wiring():
    assert REGISTRY["ncaa"] is NcaaConnector
    assert get_connector("ncaa").name == "ncaa"
    assert ENTITY_KEYS["bill_document"] == "policy_documents"
    assert NcaaConnector.default_fixture().exists()
    from app.scheduler import DEFAULT_CADENCE_S
    assert DEFAULT_CADENCE_S["ncaa"] == 30 * 24 * 3600  # monthly
