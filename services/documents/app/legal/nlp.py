"""Deterministic legal NLP (LexNLP-style, no heavy dep).

* Clause segmentation: numbered sections ("15.—(1)"), definitions sections,
  provisos ("Provided that"), schedules, preamble.
* Obligation / prohibition / permission extraction via modal-verb rules
  (shall/must → obligation; shall not/may not → prohibition; may →
  permission) with actor heuristics; VLM assist optional via ocr.vlm.
* Defined-terms extraction: quoted terms in definitions ("…" means …).
* Citation detection: Act/Law/Section/Cap references incl. Nigerian
  patterns ("Cap LFN 2004", "Cap P44 LFN 2004", "Public Procurement Act
  2007", "No. 14 of 2007").
* Cross-reference edges: CITES default; AMENDS/REPEALS/ENABLES/RESTRICTS
  from verb context.
"""
from __future__ import annotations

import re

from app.models import Citation, CitationEdge, Clause, Obligation

# ---------------------------------------------------------------------------
# Segmentation
# ---------------------------------------------------------------------------
_SECTION_START = re.compile(
    r"^\s*(\d{1,3})\s*[.–—-]\s*[—–-]?\s*(?:\((\d+)\))?\s*(.*)$")
_DEFINITIONS_HEADING = re.compile(
    r"^\s*(?:interpretation|definitions)\b", re.IGNORECASE)
_PROVISO = re.compile(r"^\s*provided\s+that\b", re.IGNORECASE)
_SCHEDULE = re.compile(r"^\s*(?:first|second|third|fourth|fifth|sixth)?\s*"
                       r"schedule\b", re.IGNORECASE)

_SUBSECTION = re.compile(r"^\s*\((\d+|[a-z]|[ivxlcdm]+)\)\s*(.*)$")

_QUOTED_TERM = re.compile(r"[\"“]([^\"”]{2,60})[\"”]\s*(?:means|shall mean|"
                          r"has the meaning|includes)")


def segment_clauses(text: str, mean_confidence: float = 0.95) -> list[Clause]:
    """Split act-style text into clauses with section paths."""
    clauses: list[Clause] = []
    current: Clause | None = None
    in_definitions = False
    counter = 0

    def flush() -> None:
        nonlocal current
        if current and current.text.strip():
            current.text = re.sub(r"\s+", " ", current.text).strip()
            clauses.append(current)
        current = None

    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            continue
        if _DEFINITIONS_HEADING.match(line):
            in_definitions = True
        m = _SECTION_START.match(line)
        # Avoid treating subsection continuations like "15(2) of..." as new
        # sections: require the "N. —" dash form or heading context.
        if m and ("." in line[:6] or "—" in line or "–" in line):
            flush()
            counter += 1
            num = m.group(1)
            sub = m.group(2)
            rest = m.group(3).strip()
            path = f"s.{num}" + (f"({sub})" if sub else "")
            heading = None
            hm = re.match(r"^(.*?)[.–—-]\s*(.*)$", rest)
            body = rest
            if hm and len(hm.group(1).split()) <= 12 and rest:
                heading, body = hm.group(1).strip(), hm.group(2).strip()
            kind = "definition" if in_definitions and counter <= 2 else "section"
            current = Clause(
                clause_id=f"clause:{num}" + (f"-{sub}" if sub else ""),
                section_path=path,
                heading=heading,
                text=body or rest,
                kind=kind,  # type: ignore[arg-type]
                confidence=round(min(0.99, mean_confidence + 0.05), 4),
            )
            continue
        if _PROVISO.match(line):
            flush()
            counter += 1
            current = Clause(clause_id=f"clause:proviso-{counter}",
                             section_path=f"proviso.{counter}",
                             text=line.strip(), kind="proviso",
                             confidence=round(mean_confidence, 4))
            continue
        if _SCHEDULE.match(line) and current is None:
            counter += 1
            current = Clause(clause_id=f"clause:schedule-{counter}",
                             section_path=f"schedule.{counter}",
                             heading=line.strip(), text="", kind="schedule",
                             confidence=round(mean_confidence, 4))
            continue
        if current is None:
            # Preamble / long title before first numbered section.
            counter += 1
            current = Clause(clause_id=f"clause:preamble-{counter}",
                             section_path=f"preamble.{counter}",
                             text=line.strip(), kind="preamble",
                             confidence=round(mean_confidence - 0.05, 4))
            continue
        sm = _SUBSECTION.match(line)
        if sm and current.kind == "section":
            current.text += f" ({sm.group(1)}) {sm.group(2).strip()}"
        else:
            current.text += " " + line.strip()
    flush()

    # Definition extraction marks definition clauses even mid-document.
    for clause in clauses:
        terms = _QUOTED_TERM.findall(clause.text)
        if terms:
            clause.defined_terms = sorted({t.strip() for t in terms})
            if "means" in clause.text or "interpretation" in (
                    clause.heading or "").lower():
                clause.kind = "definition"
    return clauses


# ---------------------------------------------------------------------------
# Obligations / prohibitions / permissions (modal-verb rules)
# ---------------------------------------------------------------------------
_MODAL_RULES: list[tuple[re.Pattern[str], str, str]] = [
    (re.compile(r"\b(?:shall|must)\s+not\b", re.I), "prohibition", "shall not"),
    (re.compile(r"\bmay\s+not\b", re.I), "prohibition", "may not"),
    (re.compile(r"\bno\s+\w+(?:\s+\w+)?\s+shall\b", re.I), "prohibition", "no … shall"),
    (re.compile(r"\bshall\b", re.I), "obligation", "shall"),
    (re.compile(r"\bmust\b", re.I), "obligation", "must"),
    (re.compile(r"\bis\s+(?:required|obliged|liable)\s+to\b", re.I),
     "obligation", "is required to"),
    (re.compile(r"\bmay\b", re.I), "permission", "may"),
    (re.compile(r"\bis\s+entitled\s+to\b", re.I), "permission", "is entitled to"),
]

_ACTOR = re.compile(
    r"\b((?:The\s+)?(?:Bureau|Board|Minister|Commission(?:er)?|Authority|"
    r"Agency|Accounting Officer|Permanent Secretary|Procuring Entity|"
    r"Contractor|Bidder|Tenderer|Government|Council|Committee|Court|"
    r"Person|Officer|Department|Institution)s?)\b")


def extract_obligations(clause: Clause) -> list[Obligation]:
    out: list[Obligation] = []
    for sent in re.split(r"(?<=[.;:])\s+", clause.text):
        for pattern, kind, modal in _MODAL_RULES:
            m = pattern.search(sent)
            if not m:
                continue
            actor_m = _ACTOR.search(sent[:m.start() + 40])
            action = sent[m.start():].strip().rstrip(".;:")
            condition = None
            cond = re.search(r"\b(?:if|where|when|unless)\b(.+)", sent, re.I)
            if cond:
                condition = cond.group(0).strip().rstrip(".;:")
            out.append(Obligation(
                kind=kind,  # type: ignore[arg-type]
                actor=actor_m.group(1) if actor_m else None,
                action=action[:400],
                condition=condition[:300] if condition else None,
                modal=modal,
            ))
            break  # one modality per sentence, first rule wins
    return out


# ---------------------------------------------------------------------------
# Citations & cross-reference edges
# ---------------------------------------------------------------------------
_NIGERIAN_ACT = re.compile(
    r"\b((?:[A-Z][\w'&-]*(?:\s+(?:of|the|and|for|on|in)\s+|\s+|[’'])){0,6}"
    r"(?:Act|Law|Decree|Edict|Regulations?|Order|Constitution))"
    r"(?:\s*,?\s*(?:No\.?\s*(\d+)\s*(?:of)?\s*)?,?\s*(\d{4}))?")
_CAP_LFN = re.compile(
    r"\bCap\.?\s*([A-Z]\d{1,3})?,?\s*(?:L\.?F\.?N\.?|Laws of the Federation"
    r"(?: of Nigeria)?)\s*,?\s*(\d{4})?", re.IGNORECASE)
_SECTION_REF = re.compile(
    r"\b(?:section|sections|s\.|ss\.)\s*(\d{1,3}(?:\s*\(\d+\))?(?:\s*\([a-z]\))?)"
    r"(?:\s+of\s+(?:the\s+)?([^.,;]{4,80}))?", re.IGNORECASE)

_GENERIC_ACT_NAMES = {"an act", "this act", "the act", "the law", "a law"}

_RELATION_VERBS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bamend(?:s|ed|ing)?\b", re.I), "AMENDS"),
    (re.compile(r"\brepeal(?:s|ed|ing)?\b", re.I), "REPEALS"),
    (re.compile(r"\b(?:establishes?|empowers?|authori[sz]es?|enables?)\b", re.I),
     "ENABLES"),
    (re.compile(r"\b(?:restricts?|limits?|prohibits?|notwithstanding)\b", re.I),
     "RESTRICTS"),
]


def detect_citations(clause: Clause) -> list[Citation]:
    found: list[Citation] = []

    def add(raw: str, title: str | None, year: int | None,
            section: str | None) -> None:
        relation = "CITES"
        # Relation verb in a small window before the reference.
        idx = clause.text.find(raw)
        window = clause.text[max(0, idx - 80):idx] if idx >= 0 else ""
        for pat, rel in _RELATION_VERBS:
            if pat.search(window) or pat.search(clause.text):
                relation = rel
                break
        found.append(Citation(
            raw=raw.strip(" ,;."), target_title=title, target_year=year,
            section_ref=section,
            relation=relation,  # type: ignore[arg-type]
        ))

    for m in _NIGERIAN_ACT.finditer(clause.text):
        title = re.sub(r"\s+", " ", m.group(1)).strip(" ,")
        if len(title) < 4 or title.lower() in _GENERIC_ACT_NAMES:
            continue
        year = int(m.group(3)) if m.group(3) else None
        add(m.group(0), title, year, None)
    for m in _CAP_LFN.finditer(clause.text):
        cap = f"Cap {m.group(1)}" if m.group(1) else "Cap"
        year = int(m.group(2)) if m.group(2) else None
        add(m.group(0), f"{cap} LFN", year, None)
    for m in _SECTION_REF.finditer(clause.text):
        target = m.group(2).strip() if m.group(2) else None
        # Skip self-references resolved inside the same act only when no
        # external act title follows.
        add(m.group(0), target, None, m.group(1).replace(" ", ""))
    return found


def build_edges(clauses: list[Clause]) -> list[CitationEdge]:
    """Cross-reference edges between clauses of this document + external
    references left as unresolved targets."""
    by_section = {c.section_path.split("(")[0].lstrip("s."): c.clause_id
                  for c in clauses}
    edges: list[CitationEdge] = []
    for clause in clauses:
        for cit in clause.citations:
            if cit.section_ref and not cit.target_title:
                sec = re.match(r"\d+", cit.section_ref)
                target_id = by_section.get(sec.group(0)) if sec else None
                if target_id and target_id != clause.clause_id:
                    edges.append(CitationEdge(
                        from_clause=clause.clause_id, to_ref=target_id,
                        relation=cit.relation, resolved=True))
                    continue
            label = cit.target_title or cit.raw
            edges.append(CitationEdge(
                from_clause=clause.clause_id,
                to_ref=f"external:{label}"
                       + (f" {cit.target_year}" if cit.target_year else ""),
                relation=cit.relation, resolved=False))
    # De-duplicate while preserving order.
    seen: set[tuple[str, str, str]] = set()
    unique: list[CitationEdge] = []
    for e in edges:
        key = (e.from_clause, e.to_ref, e.relation)
        if key not in seen:
            seen.add(key)
            unique.append(e)
    return unique


def enrich(clauses: list[Clause]) -> list[Clause]:
    """Full per-clause enrichment: obligations + citations."""
    for clause in clauses:
        clause.obligations = extract_obligations(clause)
        clause.citations = detect_citations(clause)
    return clauses
