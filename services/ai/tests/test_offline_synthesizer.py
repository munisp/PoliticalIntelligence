"""Offline synthesizer: deterministic, valid Recommendation contract (spec 9.2)."""
from __future__ import annotations

from app.llm.offline import (detect_sector, synthesize_copilot_answer,
                             synthesize_recommendation)
from app.llm.router import ModelRouter
from app.models import Recommendation
from app.retrieval.fusion import HybridRetriever


def _bundle(query="create education jobs through teacher hiring",
            jur="jur:ng-kd"):
    return HybridRetriever().retrieve(query, jur, {}, top_k=10)


def _routing(workload="premium_synthesis"):
    router = ModelRouter(base_url=None)
    _, meta = router.generate(workload, "prompt")
    return meta


def test_recommendation_contract_complete():
    rec = synthesize_recommendation(_bundle(), "education", _routing())
    assert isinstance(rec, Recommendation)
    # spec section 9.2 fields all populated
    assert rec.rationale
    assert rec.assumptions and len(rec.assumptions) >= 3
    assert rec.evidence_base, "evidence_base must reference retrieved evidence"
    assert rec.estimated_jobs > 0
    assert rec.budget_ranges and rec.budget_ranges[0].low_ngn_m < \
        rec.budget_ranges[0].high_ngn_m
    assert rec.timeline and sum(p.duration_months for p in rec.timeline) > 0
    assert rec.implementation_actors
    assert rec.legal_dependencies
    assert rec.risk_register
    assert all(r.mitigation for r in rec.risk_register)
    assert rec.kpis
    assert rec.simulation_scenarios
    engines = {s.engine for s in rec.simulation_scenarios}
    assert "forecast" in engines
    # explainability: routing metadata + confidence + evidence refs
    assert rec.model_routing.offline is True
    assert rec.model_routing.decision_id
    assert 0.0 < rec.confidence <= 1.0


def test_deterministic_same_input_same_output():
    bundle = _bundle()
    routing = _routing()
    rec1 = synthesize_recommendation(bundle, "education", routing)
    rec2 = synthesize_recommendation(bundle, "education", routing)
    assert rec1.model_dump() == rec2.model_dump()


def test_sector_detection():
    assert detect_sector("hire more teachers for schools") == "education"
    assert detect_sector("mini-grid power for rural clinics") == "electricity"
    assert detect_sector("credit for small business enterprises") == "sme"
    assert detect_sector("farm extension workers") == "agriculture"
    assert detect_sector("open tender contracting reform") == "procurement"
    assert detect_sector("vague query", hint="health") == "health"


def test_graph_evidence_enriches_legal_dependencies():
    bundle = _bundle("teacher hiring education sector jobs")
    rec = synthesize_recommendation(bundle, "education", _routing())
    joined = " ".join(rec.legal_dependencies)
    assert "UBE" in joined or "TRCN" in joined


def test_copilot_answer_has_citations_and_uncertainty():
    answer = synthesize_copilot_answer(_bundle(), _routing())
    assert answer.answer
    assert answer.citations, "SR-8: citations required"
    assert answer.uncertainty in {"low", "medium", "high"}
    assert 0.0 < answer.confidence <= 1.0
    assert answer.model_routing.offline is True


def test_copilot_empty_evidence_is_high_uncertainty():
    from app.models import EvidenceBundle
    empty = EvidenceBundle(bundle_id="evb:empty", query="zzzz",
                           jurisdiction_id="jur:ng")
    answer = synthesize_copilot_answer(empty, _routing())
    assert answer.uncertainty == "high"
    assert answer.confidence <= 0.2
