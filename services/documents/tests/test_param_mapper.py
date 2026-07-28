"""G3 param-mapper tests: instrument taxonomy, scale parsing, sector
lexicon, determinism, endpoint envelope."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.legal import nlp
from app.main import app
from app.models import Clause
from app.param_mapper import (INSTRUMENTS, SECTORS, detect_populations,
                              detect_sector, map_clauses_to_parameters,
                              parse_amount, parse_duration,
                              parse_percentage)


def _clause(text: str, *, obligations: bool = True, cid: str = "clause:1",
            confidence: float = 0.9) -> Clause:
    c = Clause(clause_id=cid, section_path="s.1", text=text,
               confidence=confidence)
    if obligations:
        c.obligations = nlp.extract_obligations(c)
    return c


def _one(text: str, **kw):
    res = map_clauses_to_parameters([_clause(text, **kw)])
    assert len(res.candidates) == 1
    return res.candidates[0]


# ---------------------------------------------------------------------------
# Instrument taxonomy — every class
# ---------------------------------------------------------------------------
def test_instrument_tax_credit():
    c = _one("A company shall be entitled to a tax credit of 15 per cent "
             "of qualifying expenditure.")
    assert c.instrument == "tax_credit"
    assert c.scale_percent == 15.0


def test_instrument_subsidy():
    c = _one("The Minister may grant a subsidy of 20 percent on fertiliser "
             "to every farmer.")
    assert c.instrument == "subsidy"
    assert c.scale_percent == 20.0


def test_instrument_grant():
    c = _one("The Board shall award a grant of ₦50 million to each "
             "accredited technology hub.")
    assert c.instrument == "grant"
    assert c.amount_ngn == 50_000_000


def test_instrument_procurement_quota():
    c = _one("A procuring entity shall apply a preference margin of 15 per "
             "cent for local content in all construction contracts.")
    assert c.instrument == "procurement_quota"
    assert c.sector == "construction"


def test_instrument_training_levy():
    c = _one("Every employer shall pay a training levy of 1 per cent of "
             "annual payroll into the training fund.")
    assert c.instrument == "training_levy"


def test_instrument_regulatory_threshold():
    c = _one("Emissions from a factory shall not exceed the threshold of "
             "250 units per month.")
    assert c.instrument == "regulatory_threshold"
    assert c.sector == "manufacturing"


def test_instrument_penalty_via_prohibition():
    c = _one("No person shall submit false information; a fine of "
             "NGN 5 million applies for every offence.")
    assert c.instrument == "penalty"
    assert c.amount_ngn == 5_000_000


# ---------------------------------------------------------------------------
# Scale parsing edge cases
# ---------------------------------------------------------------------------
def test_parse_percentage_variants():
    assert parse_percentage("shall pay 7.5% of payroll")[0] == 7.5
    assert parse_percentage("a rebate of 10 per cent")[0] == 10.0
    assert parse_percentage("up to 25 percent")[0] == 25.0
    assert parse_percentage("no numbers here") is None


def test_parse_amount_requires_currency_hint():
    assert parse_amount("section 15 million shall apply") is None
    assert parse_amount("a grant of ₦250 million")[0] == 250_000_000
    assert parse_amount("fine of NGN 5,000 thousand")[0] == 5_000_000
    assert parse_amount("₦2 billion fund")[0] == 2_000_000_000


def test_parse_duration_to_months():
    assert parse_duration("for a period of 5 years")[0] == 60
    assert parse_duration("within 18 months")[0] == 18
    assert parse_duration("over 24 months")[0] == 24
    assert parse_duration("no duration") is None


def test_duration_mapped_to_candidate():
    c = _one("The Authority may grant a tax holiday for a period of "
             "5 years to every approved farmer.")
    assert c.instrument == "tax_credit"
    assert c.duration_months == 60


# ---------------------------------------------------------------------------
# Sector lexicon & target populations
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("text,sector", [
    ("support for agriculture and livestock", "agriculture"),
    ("every manufacturing plant", "manufacturing"),
    ("broadband and digital services", "ICT"),
    ("public infrastructure and housing", "construction"),
    ("electricity and renewable energy", "energy"),
    ("every public hospital", "health"),
    ("every primary school teacher", "education"),
])
def test_sector_lexicon(text, sector):
    assert detect_sector(text) == sector
    assert sector in SECTORS


def test_sector_none_when_no_hit():
    assert detect_sector("the accounting officer shall keep records") is None


def test_population_hints():
    assert detect_populations("small and medium enterprises and youth "
                              "cooperatives") == ["SME", "youth"]
    assert "women" in detect_populations("women-owned businesses")
    c = _one("The Board shall award grants to women-led SME cooperatives.")
    assert set(c.target_population) == {"SME", "women"}


# ---------------------------------------------------------------------------
# Ranking, rationale, determinism
# ---------------------------------------------------------------------------
def test_ranking_and_review_flag():
    clauses = [
        _clause("A company shall be entitled to a tax credit of 15 per "
                "cent of qualifying expenditure.", cid="clause:2"),
        _clause("No person shall forge any licence; a fine of NGN 1 "
                "million applies.", cid="clause:9"),
    ]
    res = map_clauses_to_parameters(clauses)
    assert res.requires_analyst_review is True
    assert res.clause_count == 2
    confs = [c.confidence for c in res.candidates]
    assert confs == sorted(confs, reverse=True)
    for cand in res.candidates:
        assert cand.requires_analyst_review is True
        assert cand.instrument in INSTRUMENTS
        assert cand.confidence > 0
        # rationale points back at the source clause text span
        assert cand.rationale
        assert all(r.span.strip() for r in cand.rationale)
        assert {r.parameter for r in cand.rationale} >= {"instrument"}
        assert all(r.clause_id.startswith("clause:") for r in cand.rationale)


def test_determinism_same_input_same_output():
    clauses = nlp.enrich(nlp.segment_clauses(
        "1.—(1) Establishment. There is established a Fund.\n"
        "(2) Every employer shall pay a training levy of 1 per cent of "
        "payroll for a period of 10 years.\n"
        "2.—(1) Grants. The Board may award a grant of ₦50 million to any "
        "accredited university or school."))
    r1 = map_clauses_to_parameters(clauses)
    r2 = map_clauses_to_parameters(clauses)
    assert r1.model_dump(mode="json") == r2.model_dump(mode="json")


def test_no_instrument_no_candidate():
    res = map_clauses_to_parameters([_clause(
        "The Bureau shall maintain a register of contractors.")])
    assert res.candidates == []
    assert res.clause_count == 1


def test_merge_same_instrument_sector():
    clauses = [
        _clause("The Board may award a grant of ₦10 million to a school.",
                cid="clause:1"),
        _clause("The Board may award a grant of ₦20 million to a "
                "university.", cid="clause:2"),
    ]
    res = map_clauses_to_parameters(clauses)
    # both are grant/education → merged into one candidate
    assert len(res.candidates) == 1
    assert len(res.candidates[0].rationale) >= 2


# ---------------------------------------------------------------------------
# Endpoint envelope
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def client(tmp_path_factory):
    import os
    os.environ["DOCUMENTS_ARTIFACTS_DIR"] = str(
        tmp_path_factory.mktemp("artifacts"))
    with TestClient(app) as c:
        yield c


def test_param_map_endpoint_envelope_with_inline_clauses(client):
    body = {
        "clauses": [{
            "clause_id": "clause:1", "section_path": "s.5",
            "text": "Every employer shall pay a training levy of 1 per "
                    "cent of annual payroll.",
            "kind": "section", "confidence": 0.95,
            "obligations": [], "defined_terms": [], "citations": [],
        }],
    }
    r = client.post("/v1/param-map", json=body,
                    headers={"X-Actor-ID": "analyst:1"})
    assert r.status_code == 200
    env = r.json()
    assert set(env) >= {"data", "meta", "audit"}
    assert env["meta"]["api_version"] == "v1"
    assert env["audit"]["actor_id"] == "analyst:1"
    data = env["data"]
    assert data["requires_analyst_review"] is True
    assert data["clause_count"] == 1
    assert data["candidates"][0]["instrument"] == "training_levy"
    assert data["candidates"][0]["scale_percent"] == 1.0


def test_param_map_endpoint_requires_input(client):
    r = client.post("/v1/param-map", json={})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "PARAM_MAP_INPUT_REQUIRED"


def test_param_map_endpoint_unknown_document_404(client):
    r = client.post("/v1/param-map", json={"document_id": "doc:nope:1"})
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "ARTIFACT_NOT_FOUND"
