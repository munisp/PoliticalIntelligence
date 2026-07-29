"""I4 diff-impact tests: obligation add/remove/change, parameter deltas
(instrument + scale), determinism, endpoint envelope + 422."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.diff_impact import (compute_diff_impact, diff_obligations,
                             diff_parameters)
from app.main import app
from app.models import Clause


def _clause(cid: str, path: str, text: str) -> Clause:
    return Clause(clause_id=cid, section_path=path, text=text,
                  confidence=0.9)


BILL_A = [
    _clause("clause:1", "s.1",
            "The Minister shall establish a registry of operators."),
    _clause("clause:2", "s.2",
            "A company shall be entitled to a tax credit of 10 per cent "
            "of qualifying expenditure."),
    _clause("clause:3", "s.3",
            "An operator shall not discharge effluent into public drains."),
]

BILL_B = [
    # s.1 unchanged
    _clause("clause:1", "s.1",
            "The Minister shall establish a registry of operators."),
    # s.2 scale changed 10% → 15%
    _clause("clause:2", "s.2",
            "A company shall be entitled to a tax credit of 15 per cent "
            "of qualifying expenditure."),
    # s.3 removed; s.4 added (subsidy instrument + new obligation)
    _clause("clause:4", "s.4",
            "The Agency may grant a subsidy of ₦500 million to eligible "
            "cooperatives and shall publish eligibility criteria."),
]


def test_obligations_added_removed():
    res = compute_diff_impact(BILL_A, BILL_B)
    assert res.obligations_removed >= 1   # s.3 prohibition removed
    assert res.obligations_added >= 1     # s.4 obligation added
    removed_paths = {c.section_path for c in res.obligation_changes
                     if c.change == "removed"}
    added_paths = {c.section_path for c in res.obligation_changes
                   if c.change == "added"}
    assert "s.3" in removed_paths
    assert "s.4" in added_paths
    # Every change carries a deterministic impact note.
    for c in res.obligation_changes:
        assert c.impact_note


def test_modality_flip_is_changed():
    a = [_clause("c1", "s.5", "The Board shall audit all accounts annually.")]
    b = [_clause("c1", "s.5", "The Board may audit all accounts annually.")]
    changes = diff_obligations(a, b)
    assert any(c.change == "changed" for c in changes)
    flip = next(c for c in changes if c.change == "changed")
    assert "obligation → permission" in flip.impact_note


def test_parameter_scale_delta():
    deltas = diff_parameters(BILL_A, BILL_B)
    tax = [d for d in deltas if d.instrument == "tax_credit"]
    assert len(tax) == 1
    assert tax[0].field == "scale_percent"
    assert tax[0].change == "changed"
    assert tax[0].value_a == 10.0
    assert tax[0].value_b == 15.0
    assert tax[0].delta == 5.0
    assert "+5.0pp" in tax[0].impact_note


def test_parameter_instrument_added_removed():
    deltas = diff_parameters(BILL_A, BILL_B)
    added = [d for d in deltas if d.change == "added"]
    assert any(d.instrument == "subsidy" for d in added)


def test_determinism_and_counts():
    r1 = compute_diff_impact(BILL_A, BILL_B)
    r2 = compute_diff_impact(BILL_A, BILL_B)
    assert r1.model_dump() == r2.model_dump()
    assert r1.clauses_a == 3 and r1.clauses_b == 3
    assert r1.aligned_pairs == 2        # s.1 and s.2 shared
    assert r1.requires_analyst_review is True


def test_identical_versions_no_changes():
    res = compute_diff_impact(BILL_A, [c.model_copy(deep=True)
                                       for c in BILL_A])
    assert res.obligation_changes == []
    assert res.parameter_deltas == []


def test_endpoint_envelope_and_422():
    client = TestClient(app)
    res = client.post("/v1/diff-impact", json={
        "clauses_a": [c.model_dump(mode="json") for c in BILL_A],
        "clauses_b": [c.model_dump(mode="json") for c in BILL_B],
    })
    assert res.status_code == 200
    body = res.json()
    assert set(body) >= {"data", "meta", "audit"}
    data = body["data"]
    assert data["aligned_pairs"] == 2
    assert data["obligations_removed"] >= 1
    assert any(d["instrument"] == "tax_credit"
               for d in data["parameter_deltas"])
    # Empty input → 422
    res2 = client.post("/v1/diff-impact",
                       json={"clauses_a": [], "clauses_b": []})
    assert res2.status_code == 422
    assert res2.json()["error"]["code"] == "DIFF_IMPACT_INPUT_REQUIRED"
