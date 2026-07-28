"""Akoma Ntoso 3.0 XML generator (spec §18.4).

Produces a structurally valid AKN document:
  akomaNtoso > act > (meta FRBR) + body > section hierarchy.
FRBRthis URIs follow /akn/<country>/<doctype>/<year>/<slug> e.g.
/akn/ng/act/2007/ppa.

Validation here is a structural checklist (tests/test_akn.py): required
namespaces, FRBR identification, body sections with eId + num + content.
"""
from __future__ import annotations

import re
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape

from app.models import Clause

AKN_NS = "http://docs.oasis-open.org/legaldocml/ns/akn/3.0"


def slugify(title: str, max_len: int = 32) -> str:
    words = re.sub(r"[^a-z0-9 ]", "", title.lower()).split()
    if not words:
        return "doc"
    return "".join(w[0] for w in words[:6])[:max_len] or words[0][:max_len]


def frbr_uri(country: str, doc_type: str, year: int | None,
             slug: str) -> str:
    year_part = str(year or "undated")
    return f"/akn/{country}/{doc_type}/{year_part}/{slug}"


def _eid(section_path: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9]+", "_", section_path).strip("_")
    return f"sec_{safe}"


def build_akn(
    title: str,
    clauses: list[Clause],
    *,
    country: str = "ng",
    doc_type: str = "act",
    year: int | None = None,
    language: str = "eng",
) -> str:
    """Serialize parsed clauses to an Akoma Ntoso 3.0 XML string."""
    slug = slugify(title)
    uri = frbr_uri(country, doc_type, year, slug)

    ET.register_namespace("", AKN_NS)
    akn = ET.Element(f"{{{AKN_NS}}}akomaNtoso")
    act = ET.SubElement(akn, f"{{{AKN_NS}}}act")
    act.set("name", doc_type)

    # -- meta / FRBR identification -------------------------------------
    meta = ET.SubElement(act, f"{{{AKN_NS}}}meta")
    ident = ET.SubElement(meta, f"{{{AKN_NS}}}identification")
    ident.set("source", "#meridian-documents")
    for level, href_suffix in (("Work", ""), ("Expression", "/eng@"),
                               ("Manifestation", ".xml")):
        frbr = ET.SubElement(ident, f"{{{AKN_NS}}}FRBR{level}")
        this = ET.SubElement(frbr, f"{{{AKN_NS}}}FRBRthis")
        this.set("value", uri + href_suffix)
        uri_el = ET.SubElement(frbr, f"{{{AKN_NS}}}FRBRuri")
        uri_el.set("value", uri + href_suffix)
        date = ET.SubElement(frbr, f"{{{AKN_NS}}}FRBRdate")
        date.set("date", str(year or "undated"))
        date.set("name", level.lower())
        author = ET.SubElement(frbr, f"{{{AKN_NS}}}FRBRauthor")
        author.set("href", "#author")
    ET.SubElement(meta, f"{{{AKN_NS}}}references", source="#meridian")

    # -- body ------------------------------------------------------------
    body = ET.SubElement(act, f"{{{AKN_NS}}}body")
    for clause in clauses:
        container = "section" if clause.kind in ("section", "definition") \
            else "article"
        el = ET.SubElement(body, f"{{{AKN_NS}}}{container}")
        el.set("eId", _eid(clause.section_path))
        num = ET.SubElement(el, f"{{{AKN_NS}}}num")
        num.text = clause.section_path
        if clause.heading:
            heading = ET.SubElement(el, f"{{{AKN_NS}}}heading")
            heading.text = clause.heading
        content = ET.SubElement(el, f"{{{AKN_NS}}}content")
        p = ET.SubElement(content, f"{{{AKN_NS}}}p")
        p.text = clause.text
        for cit in clause.citations:
            ref = ET.SubElement(content, f"{{{AKN_NS}}}ref")
            target = (cit.target_title or cit.raw).replace(" ", "-")
            ref.set("href", f"/akn/ref/{target}")
            ref.text = cit.raw

    xml = ET.tostring(akn, encoding="unicode")
    return ('<?xml version="1.0" encoding="UTF-8"?>\n' + xml)


def structural_check(xml: str) -> list[str]:
    """AKN checklist — returns a list of violations (empty = valid)."""
    problems: list[str] = []
    try:
        root = ET.fromstring(xml)
    except ET.ParseError as exc:
        return [f"XML not well-formed: {exc}"]
    if not root.tag.endswith("akomaNtoso"):
        problems.append("root element is not akomaNtoso")
    act = root.find(f"{{{AKN_NS}}}act")
    if act is None:
        problems.append("missing act element")
        return problems
    ident = act.find(f"{{{AKN_NS}}}meta/{{{AKN_NS}}}identification")
    if ident is None:
        problems.append("missing meta/identification (FRBR)")
    elif ident.find(f"{{{AKN_NS}}}FRBRWork/{{{AKN_NS}}}FRBRthis") is None:
        problems.append("missing FRBRWork/FRBRthis URI")
    body = act.find(f"{{{AKN_NS}}}body")
    if body is None:
        problems.append("missing body")
    else:
        sections = list(body)
        if not sections:
            problems.append("body has no sections")
        for sec in sections:
            if not sec.get("eId"):
                problems.append(f"section missing eId: {sec.tag}")
            if sec.find(f"{{{AKN_NS}}}num") is None:
                problems.append(f"section missing num: {sec.get('eId')}")
            if sec.find(f"{{{AKN_NS}}}content") is None:
                problems.append(f"section missing content: {sec.get('eId')}")
    return problems


# ---------------------------------------------------------------------------
# G4: draft-bill writer mode (clauses + RIA annex supplied by the API)
# ---------------------------------------------------------------------------

def build_draft_akn(
    title: str,
    clauses: list[dict],
    *,
    ria: dict | None = None,
    country: str = "ng",
    doc_type: str = "bill",
    year: int | None = None,
    language: str = "eng",
) -> str:
    """Serialize an evidence-grounded draft bill to Akoma Ntoso 3.0.

    clauses: [{section_path, heading?, text, kind?}] — already generated and
    grounded by the drafting workflow; this writer only serializes.
    ria: Regulatory Impact Assessment dict → emitted as an <annex> after the
    body so the export carries consensus summary, point estimates with
    uncertainty bands, assumptions, and the reproducibility hash.
    """
    slug = slugify(title)
    uri = frbr_uri(country, doc_type, year, slug)

    ET.register_namespace("", AKN_NS)
    akn = ET.Element(f"{{{AKN_NS}}}akomaNtoso")
    act = ET.SubElement(akn, f"{{{AKN_NS}}}act")
    act.set("name", doc_type)

    meta = ET.SubElement(act, f"{{{AKN_NS}}}meta")
    ident = ET.SubElement(meta, f"{{{AKN_NS}}}identification")
    ident.set("source", "#meridian-drafting")
    for level, href_suffix in (("Work", ""), ("Expression", f"/{language}@"),
                               ("Manifestation", ".xml")):
        frbr = ET.SubElement(ident, f"{{{AKN_NS}}}FRBR{level}")
        this = ET.SubElement(frbr, f"{{{AKN_NS}}}FRBRthis")
        this.set("value", uri + href_suffix)
        uri_el = ET.SubElement(frbr, f"{{{AKN_NS}}}FRBRuri")
        uri_el.set("value", uri + href_suffix)
        date = ET.SubElement(frbr, f"{{{AKN_NS}}}FRBRdate")
        date.set("date", str(year or "undated"))
        date.set("name", level.lower())
        author = ET.SubElement(frbr, f"{{{AKN_NS}}}FRBRauthor")
        author.set("href", "#author")
    ET.SubElement(meta, f"{{{AKN_NS}}}references", source="#meridian")

    body = ET.SubElement(act, f"{{{AKN_NS}}}body")
    for clause in clauses:
        container = "article" if clause.get("kind") == "article" else "section"
        el = ET.SubElement(body, f"{{{AKN_NS}}}{container}")
        el.set("eId", _eid(clause["section_path"]))
        num = ET.SubElement(el, f"{{{AKN_NS}}}num")
        num.text = clause["section_path"]
        if clause.get("heading"):
            heading = ET.SubElement(el, f"{{{AKN_NS}}}heading")
            heading.text = clause["heading"]
        content = ET.SubElement(el, f"{{{AKN_NS}}}content")
        p = ET.SubElement(content, f"{{{AKN_NS}}}p")
        p.text = clause["text"]

    if ria:
        annex = ET.SubElement(act, f"{{{AKN_NS}}}annex")
        annex.set("eId", "annex_ria")
        anum = ET.SubElement(annex, f"{{{AKN_NS}}}num")
        anum.text = "Annex A"
        ahead = ET.SubElement(annex, f"{{{AKN_NS}}}heading")
        ahead.text = "Regulatory Impact Assessment"
        acontent = ET.SubElement(annex, f"{{{AKN_NS}}}content")

        def _p(text: str) -> None:
            el = ET.SubElement(acontent, f"{{{AKN_NS}}}p")
            el.text = text

        _p(str(ria.get("consensus_summary", "")))
        estimates = ria.get("point_estimates") or []
        if estimates:
            _p("Point estimates: " + "; ".join(
                f"{e.get('metric')} {e.get('value')} {e.get('unit')} "
                f"(80% band {e.get('lower')}–{e.get('upper')}, "
                f"horizon {e.get('horizon_months')}m)" for e in estimates))
        assumptions = ria.get("assumptions") or []
        if assumptions:
            _p("Assumptions: " + "; ".join(str(a) for a in assumptions))
        _p(f"Reproducibility hash: {ria.get('reproducibility_hash', '')} "
           f"(simulation run {ria.get('simulation_run_id', '')}, "
           f"engine {ria.get('engine', '')})")
        citations = ria.get("citations") or []
        if citations:
            _p("Citations: " + "; ".join(str(c.get("citation", ""))
                                         for c in citations))

    xml = ET.tostring(akn, encoding="unicode")
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + xml
