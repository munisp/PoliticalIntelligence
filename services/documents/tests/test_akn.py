"""Akoma Ntoso generation + structural checklist tests."""
from __future__ import annotations

from xml.etree import ElementTree as ET

from app.akn import AKN_NS, build_akn, frbr_uri, slugify, structural_check
from app.legal import nlp

from .fixtures import PPA_EXCERPT


def _akn():
    clauses = nlp.enrich(nlp.segment_clauses(PPA_EXCERPT))
    return build_akn("Public Procurement Act", clauses, country="ng",
                     doc_type="act", year=2007)


def test_frbr_uri_and_slug():
    assert slugify("Public Procurement Act") == "ppa"
    assert frbr_uri("ng", "act", 2007, "ppa") == "/akn/ng/act/2007/ppa"


def test_akn_passes_structural_checklist():
    xml = _akn()
    assert structural_check(xml) == []


def test_akn_hierarchy_and_namespaces():
    root = ET.fromstring(_akn())
    assert root.tag == f"{{{AKN_NS}}}akomaNtoso"
    act = root.find(f"{{{AKN_NS}}}act")
    assert act is not None
    ident = act.find(f"{{{AKN_NS}}}meta/{{{AKN_NS}}}identification")
    this = ident.find(f"{{{AKN_NS}}}FRBRWork/{{{AKN_NS}}}FRBRthis")
    assert this.get("value") == "/akn/ng/act/2007/ppa"
    sections = act.findall(f"{{{AKN_NS}}}body/{{{AKN_NS}}}section")
    eids = {s.get("eId") for s in sections}
    assert "sec_s_1" in eids and "sec_s_16" in eids
    s1 = next(s for s in sections if s.get("eId") == "sec_s_1")
    assert s1.find(f"{{{AKN_NS}}}num").text == "s.1"
    assert s1.find(f"{{{AKN_NS}}}heading").text == "Establishment of the Bureau"
    content = s1.find(f"{{{AKN_NS}}}content/{{{AKN_NS}}}p")
    assert "register of contractors" in content.text


def test_akn_citation_refs_serialized():
    root = ET.fromstring(_akn())
    refs = root.findall(f".//{{{AKN_NS}}}ref")
    assert refs, "expected citation refs in AKN"
    assert any("Cap-P44-LFN" in (r.get("href") or "") for r in refs)


def test_checklist_catches_invalid_xml():
    assert structural_check("<notxml")
    assert structural_check("<akomaNtoso/>")


# ---------------------------------------------------------------------------
# G4: draft-bill writer mode
# ---------------------------------------------------------------------------

DRAFT_CLAUSES = [
    {"section_path": "s.1", "heading": "Interpretation and Definitions",
     "text": "In this Bill, unless the context otherwise requires..."},
    {"section_path": "s.2", "heading": "Enabling Instruments",
     "text": "(1) There is hereby established the enabling instrument..."},
]

RIA = {
    "simulation_run_id": "run:test-123",
    "scenario_id": "scn:ng-kd:test",
    "engine": "system_dynamics",
    "consensus_summary": "The system_dynamics engine projects employment "
                         "growth over 36 months.",
    "point_estimates": [
        {"metric": "employment", "unit": "jobs", "value": 4200,
         "lower": 3100, "upper": 5300, "horizon_months": 36},
    ],
    "assumptions": ["Engine seed 42 reproduces the projection"],
    "reproducibility_hash": "ab" * 32,
    "citations": [{"evidence_source_id": "ev:1",
                   "citation": "KDSG Labour Force Survey 2024"}],
    "generated_at": "2026-01-01T00:00:00Z",
}


def test_build_draft_akn_well_formed_with_annex():
    from app.akn import build_draft_akn

    xml = build_draft_akn("Kaduna Skills Bill", DRAFT_CLAUSES, ria=RIA,
                          year=2026)
    assert structural_check(xml) == []
    root = ET.fromstring(xml)
    act = root.find(f"{{{AKN_NS}}}act")
    assert act is not None and act.get("name") == "bill"
    this = act.find(
        f"{{{AKN_NS}}}meta/{{{AKN_NS}}}identification/"
        f"{{{AKN_NS}}}FRBRWork/{{{AKN_NS}}}FRBRthis")
    assert this.get("value") == "/akn/ng/bill/2026/ksb"
    annex = act.find(f"{{{AKN_NS}}}annex")
    assert annex is not None and annex.get("eId") == "annex_ria"
    text = "".join(annex.itertext())
    assert "Regulatory Impact Assessment" in text
    assert RIA["reproducibility_hash"] in text
    assert "80% band 3100–5300" in text
    assert "KDSG Labour Force Survey 2024" in text


def test_build_draft_akn_without_ria_has_no_annex():
    from app.akn import build_draft_akn

    xml = build_draft_akn("Plain Draft", DRAFT_CLAUSES)
    assert structural_check(xml) == []
    root = ET.fromstring(xml)
    assert root.find(f"{{{AKN_NS}}}act/{{{AKN_NS}}}annex") is None
    sections = root.findall(f"{{{AKN_NS}}}act/{{{AKN_NS}}}body/"
                            f"{{{AKN_NS}}}section")
    assert [s.get("eId") for s in sections] == ["sec_s_1", "sec_s_2"]
    assert sections[0].find(f"{{{AKN_NS}}}heading").text == \
        "Interpretation and Definitions"


def test_draft_akn_endpoint():
    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)
    resp = client.post("/v1/akn/draft", json={
        "title": "Endpoint Draft Bill",
        "clauses": DRAFT_CLAUSES,
        "ria": RIA,
        "year": 2026,
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["meta"]["request_id"]
    data = body["data"]
    assert data["problems"] == []
    assert data["akn_xml"].startswith("<?xml")
    assert "annex" in data["akn_xml"]
    # Validation: missing clauses → 422-ish service error
    bad = client.post("/v1/akn/draft", json={"title": "x", "clauses": []})
    assert bad.status_code in (400, 422)
