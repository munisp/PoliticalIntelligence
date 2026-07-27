"""Legal NLP tests on a Public Procurement Act–style excerpt."""
from __future__ import annotations

from app.legal import nlp

from .fixtures import PPA_EXCERPT


def _clauses():
    return nlp.segment_clauses(PPA_EXCERPT)


def test_clause_segmentation_sections():
    clauses = _clauses()
    paths = [c.section_path for c in clauses]
    assert "s.1" in paths and "s.2" in paths and "s.16" in paths
    s1 = next(c for c in clauses if c.section_path == "s.1")
    assert s1.heading == "Establishment of the Bureau"
    assert "(1) There is established" in s1.text
    assert "(2) The Bureau shall maintain" in s1.text


def test_clause_segmentation_proviso_and_definitions():
    clauses = _clauses()
    proviso = [c for c in clauses if c.kind == "proviso"]
    assert proviso and "waive the requirement" in proviso[0].text
    defs = [c for c in clauses if c.kind == "definition"]
    assert defs, "interpretation section should be a definition clause"
    terms = set(defs[0].defined_terms)
    assert {"Bureau", "Procuring Entity"} <= terms


def test_obligation_extraction():
    clauses = nlp.enrich(_clauses())
    obligations = [o for c in clauses for o in c.obligations]
    kinds = {o.kind for o in obligations}
    assert "obligation" in kinds and "prohibition" in kinds \
        and "permission" in kinds
    shall = next(o for o in obligations if o.modal == "shall")
    assert shall.actor == "The Bureau"
    assert "register of contractors" in shall.action
    prohibition = next(o for o in obligations if o.kind == "prohibition")
    assert "false information" in prohibition.action


def test_citation_detection_nigerian_patterns():
    clauses = nlp.enrich(_clauses())
    s16 = next(c for c in clauses if c.section_path == "s.16")
    raws = [c.raw for c in s16.citations]
    assert any("Cap P44 LFN 2004" in r for r in raws)
    assert any("Fiscal Responsibility Act" in r for r in raws)
    # AMENDS relation from verb context
    assert any(c.relation == "AMENDS" for c in s16.citations)
    sec_ref = next(c for c in s16.citations if c.section_ref)
    assert sec_ref.section_ref == "3"


def test_cross_reference_edges():
    clauses = nlp.enrich(_clauses())
    edges = nlp.build_edges(clauses)
    assert edges, "expected citation edges"
    external = [e for e in edges if not e.resolved]
    assert any("Fiscal Responsibility Act 2007" in e.to_ref for e in external)
    # de-duplicated
    keys = [(e.from_clause, e.to_ref, e.relation) for e in edges]
    assert len(keys) == len(set(keys))


def test_internal_section_reference_resolves():
    text = (
        "1. — Establishment.\nThe Bureau is established.\n"
        "2. — Register.\nThe register under section 1 shall be public.\n")
    clauses = nlp.enrich(nlp.segment_clauses(text))
    edges = nlp.build_edges(clauses)
    resolved = [e for e in edges if e.resolved]
    assert any(e.from_clause == "clause:2" and e.to_ref == "clause:1"
               for e in resolved)
