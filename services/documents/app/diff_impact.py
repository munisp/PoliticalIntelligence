"""I4 — legislative diff-impact analyzer (deterministic, no LLM).

Given two versions of a bill (clauses A vs B), diffs:

* obligations — added / removed / changed duty-modality constructs
  (reuses ``app.legal.nlp.extract_obligations`` when clauses arrive without
  pre-computed obligations);
* parameter deltas — instrument/scale changes between versions, reusing
  the G3 param-mapper structures (``app.param_mapper.candidate_from_clause``
  + ``merge_candidates``), keyed by (instrument, sector);
* impact note per change — deterministic, template-generated rationale.

All rules are pure functions of the two clause lists → deterministic and
unit-testable.
"""
from __future__ import annotations

import re

from pydantic import BaseModel, Field

from app.legal.nlp import extract_obligations
from app.models import Clause, Obligation
from app.param_mapper import (
    AssumptionCandidate,
    candidate_from_clause,
    merge_candidates,
)

# ---------------------------------------------------------------------------
# Output models
# ---------------------------------------------------------------------------


class ObligationChange(BaseModel):
    change: str                    # "added" | "removed" | "changed"
    section_path: str
    kind: str                      # obligation | prohibition | permission
    actor: str | None = None
    action_a: str | None = None
    action_b: str | None = None
    impact_note: str


class ParameterDelta(BaseModel):
    instrument: str
    sector: str | None = None
    field: str                     # instrument|scale_percent|amount_ngn|duration_months
    change: str                    # "added" | "removed" | "changed"
    value_a: float | str | None = None
    value_b: float | str | None = None
    delta: float | None = None     # numeric delta for changed numeric fields
    impact_note: str


class DiffImpactResult(BaseModel):
    clauses_a: int
    clauses_b: int
    aligned_pairs: int
    obligations_added: int
    obligations_removed: int
    obligations_changed: int
    obligation_changes: list[ObligationChange] = Field(default_factory=list)
    parameter_deltas: list[ParameterDelta] = Field(default_factory=list)
    requires_analyst_review: bool = True


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ensure_obligations(clause: Clause) -> Clause:
    if not clause.obligations:
        clause.obligations = extract_obligations(clause)
    return clause


def _obl_key(o: Obligation) -> tuple[str, str, str]:
    """Natural key for an obligation within a clause."""
    return (o.kind, (o.actor or "").lower(), o.action.strip().lower()[:160])


_MODAL_PREFIX = re.compile(
    r"^(?:shall\s+not|may\s+not|shall|must|may)\s+", re.I)


def _norm_action(action: str) -> str:
    """Action key with the leading modal stripped, so modality flips align."""
    return _MODAL_PREFIX.sub("", action.strip().lower())[:160]


def _candidates_by_instrument(
    clauses: list[Clause],
) -> dict[tuple[str, str | None], AssumptionCandidate]:
    raw = [c for cl in clauses if (c := candidate_from_clause(cl)) is not None]
    merged = merge_candidates(raw)
    return {(c.instrument, c.sector): c for c in merged}


def _fmt_amount(n: float | None) -> str:
    if n is None:
        return "—"
    if n >= 1_000_000_000:
        return f"₦{n / 1_000_000_000:.2f}bn"
    if n >= 1_000_000:
        return f"₦{n / 1_000_000:.1f}m"
    return f"₦{n:,.0f}"


# ---------------------------------------------------------------------------
# Core diff
# ---------------------------------------------------------------------------


def diff_obligations(
    clauses_a: list[Clause], clauses_b: list[Clause]
) -> list[ObligationChange]:
    """Obligation-level diff aligned on section_path."""
    changes: list[ObligationChange] = []
    by_path_a = {c.section_path: _ensure_obligations(c) for c in clauses_a}
    by_path_b = {c.section_path: _ensure_obligations(c) for c in clauses_b}

    for path in sorted(set(by_path_a) | set(by_path_b)):
        ca, cb = by_path_a.get(path), by_path_b.get(path)
        if ca and not cb:
            for o in ca.obligations:
                changes.append(ObligationChange(
                    change="removed", section_path=path, kind=o.kind,
                    actor=o.actor, action_a=o.action,
                    impact_note=(
                        f"Clause {path} removed: {o.kind} on "
                        f"{o.actor or 'unspecified actor'} no longer applies.")))
            continue
        if cb and not ca:
            for o in cb.obligations:
                changes.append(ObligationChange(
                    change="added", section_path=path, kind=o.kind,
                    actor=o.actor, action_b=o.action,
                    impact_note=(
                        f"New clause {path}: introduces {o.kind} for "
                        f"{o.actor or 'unspecified actor'}.")))
            continue
        assert ca is not None and cb is not None
        keys_a = {_obl_key(o): o for o in ca.obligations}
        keys_b = {_obl_key(o): o for o in cb.obligations}
        for k, o in keys_a.items():
            if k not in keys_b:
                changes.append(ObligationChange(
                    change="removed", section_path=path, kind=o.kind,
                    actor=o.actor, action_a=o.action,
                    impact_note=(
                        f"{path}: {o.kind} removed for "
                        f"{o.actor or 'unspecified actor'}.")))
        for k, o in keys_b.items():
            if k not in keys_a:
                changes.append(ObligationChange(
                    change="added", section_path=path, kind=o.kind,
                    actor=o.actor, action_b=o.action,
                    impact_note=(
                        f"{path}: new {o.kind} for "
                        f"{o.actor or 'unspecified actor'}.")))
        # Modality flips (same actor+action modulo the modal verb,
        # different kind) → "changed".
        flip_a = {(o.actor or "", _norm_action(o.action)): o
                  for o in ca.obligations}
        flip_b = {(o.actor or "", _norm_action(o.action)): o
                  for o in cb.obligations}
        for fk, oa in flip_a.items():
            ob = flip_b.get(fk)
            if ob and oa.kind != ob.kind:
                changes.append(ObligationChange(
                    change="changed", section_path=path, kind=ob.kind,
                    actor=ob.actor, action_a=oa.action, action_b=ob.action,
                    impact_note=(
                        f"{path}: modality shift {oa.kind} → {ob.kind} for "
                        f"{ob.actor or 'unspecified actor'} — compliance "
                        "posture changes materially.")))
    # Deterministic order: path, then change severity, then action.
    order = {"removed": 0, "changed": 1, "added": 2}
    changes.sort(key=lambda c: (c.section_path, order[c.change],
                                c.action_a or c.action_b or ""))
    return changes


_NUMERIC_FIELDS = ("scale_percent", "amount_ngn", "duration_months")


def diff_parameters(
    clauses_a: list[Clause], clauses_b: list[Clause]
) -> list[ParameterDelta]:
    """Instrument/scale deltas via the G3 param-mapper structures."""
    deltas: list[ParameterDelta] = []
    inst_a = _candidates_by_instrument(clauses_a)
    inst_b = _candidates_by_instrument(clauses_b)

    for key in sorted(set(inst_a) | set(inst_b)):
        ca, cb = inst_a.get(key), inst_b.get(key)
        instrument, sector = key
        sector_txt = f" ({sector})" if sector else ""
        if ca and not cb:
            deltas.append(ParameterDelta(
                instrument=instrument, sector=sector, field="instrument",
                change="removed", value_a=instrument,
                impact_note=(
                    f"Instrument {instrument}{sector_txt} removed — scenario "
                    "assumption sets relying on it must be retired.")))
            continue
        if cb and not ca:
            deltas.append(ParameterDelta(
                instrument=instrument, sector=sector, field="instrument",
                change="added", value_b=instrument,
                impact_note=(
                    f"New instrument {instrument}{sector_txt} — model plan "
                    "should add a matching assumption candidate.")))
            continue
        assert ca is not None and cb is not None
        for field in _NUMERIC_FIELDS:
            va = getattr(ca, field)
            vb = getattr(cb, field)
            if va == vb:
                continue
            delta = None
            if va is not None and vb is not None:
                delta = round(vb - va, 4)
            if field == "scale_percent":
                note = (f"{instrument}{sector_txt}: rate {va}% → {vb}%"
                        f" ({'+' if (delta or 0) >= 0 else ''}{delta}pp).")
            elif field == "amount_ngn":
                note = (f"{instrument}{sector_txt}: amount "
                        f"{_fmt_amount(va)} → {_fmt_amount(vb)}.")
            else:
                note = (f"{instrument}{sector_txt}: duration "
                        f"{va} → {vb} months.")
            deltas.append(ParameterDelta(
                instrument=instrument, sector=sector, field=field,
                change="changed", value_a=va, value_b=vb, delta=delta,
                impact_note=note))
    order = {"removed": 0, "changed": 1, "added": 2}
    deltas.sort(key=lambda d: (d.instrument, order[d.change], d.field))
    return deltas


def compute_diff_impact(
    clauses_a: list[Clause], clauses_b: list[Clause]
) -> DiffImpactResult:
    """Full diff-impact analysis for two bill versions (deterministic)."""
    obl = diff_obligations(clauses_a, clauses_b)
    par = diff_parameters(clauses_a, clauses_b)
    paths_a = {c.section_path for c in clauses_a}
    paths_b = {c.section_path for c in clauses_b}
    return DiffImpactResult(
        clauses_a=len(clauses_a),
        clauses_b=len(clauses_b),
        aligned_pairs=len(paths_a & paths_b),
        obligations_added=sum(1 for c in obl if c.change == "added"),
        obligations_removed=sum(1 for c in obl if c.change == "removed"),
        obligations_changed=sum(1 for c in obl if c.change == "changed"),
        obligation_changes=obl,
        parameter_deltas=par,
        requires_analyst_review=True,
    )
