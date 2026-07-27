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
