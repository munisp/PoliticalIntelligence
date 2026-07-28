"""G3: legal-NLP → simulation-parameter mapper (deterministic, no LLM).

Maps extracted legal constructs (clauses + obligations from
``app.legal.nlp``) to ranked candidate scenario assumption sets for the
simulation service:

* instrument taxonomy — tax_credit, subsidy, grant, procurement_quota,
  training_levy, regulatory_threshold, penalty (keyword rules)
* scale estimation — percentages / currency amounts / durations parsed
  from clause text with regex + number parsing
* sector detection — keyword lexicon (agriculture, manufacturing, ICT,
  construction, energy, health, education)
* target population hints — SME, youth, women

Every candidate carries ``confidence``, ``rationale`` (the clause text span
that produced each parameter) and ``requires_analyst_review: true``. All
rules are pure functions of the input clauses → deterministic and
unit-testable.
"""
from __future__ import annotations

import re

from pydantic import BaseModel, Field

from app.models import Clause

# ---------------------------------------------------------------------------
# Output models
# ---------------------------------------------------------------------------
INSTRUMENTS = (
    "tax_credit", "subsidy", "grant", "procurement_quota",
    "training_levy", "regulatory_threshold", "penalty",
)
SECTORS = (
    "agriculture", "manufacturing", "ICT", "construction",
    "energy", "health", "education",
)
POPULATIONS = ("SME", "youth", "women")


class RationaleSpan(BaseModel):
    """One clause text span that produced a mapped parameter."""
    clause_id: str
    section_path: str
    span: str          # verbatim excerpt from the clause text
    parameter: str     # which parameter this span produced


class AssumptionCandidate(BaseModel):
    instrument: str
    scale_percent: float | None = None    # e.g. 7.5 for a 7.5% rate
    amount_ngn: float | None = None       # absolute naira amount
    duration_months: int | None = None
    sector: str | None = None
    target_population: list[str] = Field(default_factory=list)
    confidence: float = 0.0
    rationale: list[RationaleSpan] = Field(default_factory=list)
    requires_analyst_review: bool = True


class ParamMapResult(BaseModel):
    candidates: list[AssumptionCandidate]
    clause_count: int
    requires_analyst_review: bool = True


# ---------------------------------------------------------------------------
# Instrument taxonomy (keyword rules)
# ---------------------------------------------------------------------------
# (instrument, pattern, rule weight) — first match per clause wins; weight
# feeds the deterministic confidence formula.
_INSTRUMENT_RULES: list[tuple[str, re.Pattern[str], float]] = [
    ("tax_credit", re.compile(
        r"\btax\s+(?:credit|relief|rebate|holiday|exemption)\b", re.I), 0.90),
    ("subsidy", re.compile(r"\bsubsid(?:y|ies|ise|ize|ised|ized)\b", re.I),
     0.88),
    # procurement_quota before grant: "grant a margin of preference for
    # local content" is a quota instrument, not a fiscal grant.
    ("procurement_quota", re.compile(
        r"\b(?:procurement\s+quota|local\s+content|preference\s+margin|"
        r"quota\b|set[-\s]?aside)\b", re.I), 0.86),
    ("grant", re.compile(r"\bgrants?\b", re.I), 0.82),
    ("training_levy", re.compile(
        r"\b(?:training\s+levy|levy\b|apprenticeship(?:\s+fund)?|"
        r"training\s+fund)\b", re.I), 0.85),
    ("regulatory_threshold", re.compile(
        r"\b(?:threshold|shall\s+not\s+exceed|minimum\s+(?:capital|"
        r"threshold|requirement)|licen[cs]e\s+requirement)\b", re.I), 0.78),
    ("penalty", re.compile(
        r"\b(?:penalt(?:y|ies)|fine\b|sanction|offence|surcharge)\b",
        re.I), 0.84),
]

# Penalty-related obligations reclassify weak matches: if the clause has a
# prohibition obligation and matched "grant"-like weak text, prefer penalty.
_PENALTY_RE = _INSTRUMENT_RULES[-1][1]

# ---------------------------------------------------------------------------
# Scale parsing (percentages, amounts, durations)
# ---------------------------------------------------------------------------
_PERCENT_RE = re.compile(
    r"(\d{1,3}(?:\.\d+)?)\s*(?:per\s*cent|percent|%)", re.I)
_AMOUNT_RE = re.compile(
    r"(?:₦|NGN|N\s*=?\s?|naira\s+)?(\d[\d,]*(?:\.\d+)?)\s*"
    r"(million|billion|thousand|m\b|bn\b)?"
    r"(?:\s*(?:naira|NGN|₦))?", re.I)
_CURRENCY_HINT = re.compile(r"₦|NGN|\bnaira\b", re.I)
_DURATION_RE = re.compile(
    r"(\d{1,4})\s*(years?|yrs?|months?|mos?|weeks?|days?)", re.I)

_UNIT_MULTIPLIER = {
    "thousand": 1_000, "million": 1_000_000, "billion": 1_000_000_000,
    "m": 1_000_000, "bn": 1_000_000_000,
}
_DURATION_TO_MONTHS = {"year": 12, "yr": 12, "month": 1, "mo": 1,
                       "week": 0.25, "day": 1 / 30.0}


def parse_percentage(text: str) -> tuple[float, str] | None:
    """First percentage in text → (value, matched span)."""
    m = _PERCENT_RE.search(text)
    if not m:
        return None
    return float(m.group(1)), m.group(0)


def parse_amount(text: str) -> tuple[float, str] | None:
    """First currency-looking amount → (naira value, matched span).

    Requires a currency hint (₦ / NGN / naira) adjacent to the number to
    avoid mistaking section numbers for amounts.
    """
    if not _CURRENCY_HINT.search(text):
        return None
    m = _AMOUNT_RE.search(text)
    if not m:
        return None
    value = float(m.group(1).replace(",", ""))
    unit = (m.group(2) or "").lower().rstrip(".")
    value *= _UNIT_MULTIPLIER.get(unit, 1)
    return value, m.group(0).strip()


def parse_duration(text: str) -> tuple[int, str] | None:
    """First duration expression → (months (rounded), matched span)."""
    m = _DURATION_RE.search(text)
    if not m:
        return None
    n = int(m.group(1))
    unit = m.group(2).lower().rstrip("s")
    months = n * _DURATION_TO_MONTHS.get(unit, 0)
    return max(1, round(months)), m.group(0)


# ---------------------------------------------------------------------------
# Sector lexicon & target population hints
# ---------------------------------------------------------------------------
SECTOR_LEXICON: dict[str, tuple[str, ...]] = {
    "agriculture": ("agriculture", "agricultural", "farming", "farmer",
                    "crop", "livestock", "agro", "fisheries"),
    "manufacturing": ("manufacturing", "manufacturer", "factory",
                      "industrial", "production plant"),
    "ICT": ("ict", "information technology", "digital", "telecom",
            "software", "broadband", "technology hub"),
    "construction": ("construction", "building works", "infrastructure",
                     "housing", "contractor"),
    "energy": ("energy", "electricity", "power sector", "petroleum",
               "gas", "renewable", "solar"),
    "health": ("health", "hospital", "medical", "clinic", "pharmaceutical"),
    "education": ("education", "school", "teacher", "student", "university",
                  "tertiary institution"),
}

POPULATION_LEXICON: dict[str, tuple[str, ...]] = {
    "SME": ("sme", "msme", "small and medium", "small-scale enterprise",
            "micro enterprise"),
    "youth": ("youth", "young person", "young people", "graduate trainee"),
    "women": ("women", "female", "gender", "widow"),
}


def detect_sector(text: str) -> str | None:
    """First sector whose lexicon hits (longest hit wins ties by order)."""
    low = text.lower()
    best: tuple[int, str] | None = None  # (hit length, sector)
    for sector in SECTORS:
        for kw in SECTOR_LEXICON[sector]:
            if kw in low:
                if best is None or len(kw) > best[0]:
                    best = (len(kw), sector)
    return best[1] if best else None


def detect_populations(text: str) -> list[str]:
    low = text.lower()
    return [p for p in POPULATIONS
            if any(kw in low for kw in POPULATION_LEXICON[p])]


# ---------------------------------------------------------------------------
# Clause → candidate mapping
# ---------------------------------------------------------------------------
def _instrument_for(clause: Clause) -> tuple[str, float, str] | None:
    """(instrument, rule weight, matched span) for a clause, or None."""
    # Penalty/prohibition context takes precedence when both fire.
    penalty_m = _PENALTY_RE.search(clause.text)
    if penalty_m and any(o.kind == "prohibition"
                         for o in clause.obligations):
        return "penalty", 0.88, penalty_m.group(0)
    for instrument, pattern, weight in _INSTRUMENT_RULES:
        m = pattern.search(clause.text)
        if m:
            return instrument, weight, m.group(0)
    return None


def _span(clause: Clause, matched: str, parameter: str) -> RationaleSpan:
    """Rationale span: a ±60-char verbatim window around the match."""
    idx = clause.text.lower().find(matched.lower())
    if idx < 0:
        excerpt = clause.text[:120]
    else:
        start = max(0, idx - 60)
        end = min(len(clause.text), idx + len(matched) + 60)
        excerpt = clause.text[start:end].strip()
    return RationaleSpan(clause_id=clause.clause_id,
                         section_path=clause.section_path,
                         span=excerpt, parameter=parameter)


def candidate_from_clause(clause: Clause) -> AssumptionCandidate | None:
    """Map one enriched clause to an assumption-set candidate (or None)."""
    found = _instrument_for(clause)
    if not found:
        return None
    instrument, weight, matched = found
    rationale = [_span(clause, matched, "instrument")]

    pct = parse_percentage(clause.text)
    if pct:
        rationale.append(_span(clause, pct[1], "scale_percent"))
    amt = parse_amount(clause.text)
    if amt:
        rationale.append(_span(clause, amt[1], "amount_ngn"))
    dur = parse_duration(clause.text)
    if dur:
        rationale.append(_span(clause, dur[1], "duration_months"))
    sector = detect_sector(clause.text)
    if sector:
        rationale.append(_span(clause, sector, "sector"))
    populations = detect_populations(clause.text)

    # Deterministic confidence: rule weight × clause OCR/NLP confidence,
    # + small bonuses for each corroborating parameter extracted.
    bonus = (0.04 if pct else 0) + (0.04 if amt else 0) \
        + (0.03 if dur else 0) + (0.03 if sector else 0) \
        + (0.02 if populations else 0)
    confidence = round(min(0.99, weight * clause.confidence + bonus), 4)

    return AssumptionCandidate(
        instrument=instrument,
        scale_percent=pct[0] if pct else None,
        amount_ngn=amt[0] if amt else None,
        duration_months=dur[0] if dur else None,
        sector=sector,
        target_population=populations,
        confidence=confidence,
        rationale=rationale,
        requires_analyst_review=True,
    )


def merge_candidates(candidates: list[AssumptionCandidate]) -> list[
        AssumptionCandidate]:
    """Merge candidates for the same (instrument, sector): keep highest
    confidence values per field, concatenate rationale deterministically."""
    merged: dict[tuple[str, str | None], AssumptionCandidate] = {}
    for c in candidates:
        key = (c.instrument, c.sector)
        if key not in merged:
            merged[key] = c.model_copy(deep=True)
            continue
        m = merged[key]
        m.confidence = round(max(m.confidence, c.confidence), 4)
        m.scale_percent = m.scale_percent or c.scale_percent
        m.amount_ngn = m.amount_ngn or c.amount_ngn
        m.duration_months = m.duration_months or c.duration_months
        m.target_population = sorted(
            set(m.target_population) | set(c.target_population))
        m.rationale.extend(c.rationale)
    return list(merged.values())


def map_clauses_to_parameters(clauses: list[Clause], top_k: int = 10
                              ) -> ParamMapResult:
    """Ranked candidate assumption sets from enriched legal-NLP clauses.

    Deterministic: same clauses in → same ranked candidates out.
    """
    raw = [c for clause in clauses
           if (c := candidate_from_clause(clause)) is not None]
    merged = merge_candidates(raw)
    # Stable ranking: confidence desc, then instrument, then sector.
    merged.sort(key=lambda c: (-c.confidence, c.instrument,
                               c.sector or ""))
    return ParamMapResult(candidates=merged[:top_k],
                          clause_count=len(clauses),
                          requires_analyst_review=True)
