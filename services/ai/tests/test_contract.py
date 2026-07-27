"""§9.2 contract validator: valid / invalid / repair, prompt bundles."""
from __future__ import annotations

import json

from app.llm.prompts import BUNDLES, get_bundle
from app.llm.prompts.contract import (ContractResult, generate_with_contract,
                                      validate_recommendation_contract)


def _valid_payload() -> dict:
    return {
        "title": "Programme",
        "rationale": "Because evidence.",
        "assumptions": ["a"],
        "evidence_base": [{"citation": "UBE Act 2004, s.2",
                           "evidence_source_id": "pas:ube-act-2004-s2"}],
        "estimated_jobs": 1200,
        "budget_ranges": [{"low_ngn_m": 1.0, "high_ngn_m": 2.0}],
        "timeline": [{"phase": "p", "duration_months": 3}],
        "implementation_actors": ["SUBEB"],
        "legal_dependencies": ["UBE Act 2004"],
        "risk_register": [{"risk": "r", "likelihood": "low", "impact": "low"}],
        "kpis": [{"name": "k", "target": "t", "measurement": "m"}],
        "simulation_scenarios": [{"engine": "forecast"}],
        "confidence": 0.7,
    }


def test_valid_output_passes():
    res = validate_recommendation_contract(json.dumps(_valid_payload()))
    assert res.ok and res.data and not res.repaired


def test_missing_keys_fail():
    payload = _valid_payload()
    del payload["evidence_base"]
    del payload["confidence"]
    res = validate_recommendation_contract(json.dumps(payload))
    assert not res.ok
    assert any("evidence_base" in e for e in res.errors)
    assert any("confidence" in e for e in res.errors)


def test_empty_evidence_fails():
    payload = _valid_payload()
    payload["evidence_base"] = []
    res = validate_recommendation_contract(json.dumps(payload))
    assert not res.ok
    assert any("at least 1" in e for e in res.errors)


def test_bad_confidence_fails():
    payload = _valid_payload()
    payload["confidence"] = 1.7
    res = validate_recommendation_contract(json.dumps(payload))
    assert not res.ok and any("confidence" in e for e in res.errors)


def test_repair_fenced_prose_output():
    raw = ("Here is the recommendation you asked for:\n"
           "```json\n" + json.dumps(_valid_payload()) + "\n```\nHope this helps!")
    res = validate_recommendation_contract(raw)
    assert res.ok and res.repaired


def test_unparseable_output_fails():
    res = validate_recommendation_contract("no json here at all")
    assert not res.ok and res.errors


class _FakeRouter:
    """Answers badly once, then validly — exercises the repair retry."""

    def __init__(self):
        self.calls = 0

    def generate(self, workload_class, prompt, request_id="-"):
        self.calls += 1
        if self.calls == 1:
            return '{"title": "broken"}', object()
        return json.dumps(_valid_payload()), object()


def test_generate_with_contract_one_repair_retry():
    router = _FakeRouter()
    data, _meta, result = generate_with_contract(router, "interactive_copilot",
                                                 "prompt")
    assert router.calls == 2
    assert data is not None and result.ok


class _AlwaysBadRouter:
    def generate(self, workload_class, prompt, request_id="-"):
        return "not json", object()


def test_generate_with_contract_gives_up_after_retry():
    data, _meta, result = generate_with_contract(
        _AlwaysBadRouter(), "interactive_copilot", "prompt")
    assert data is None and not result.ok


# ---------------------------------------------------------------------------
# Prompt bundles
# ---------------------------------------------------------------------------
def test_bundles_present_and_versioned():
    for name in ("recommendation_v1", "copilot_grounded_v1", "brief_memo_v1",
                 "legal_extract_v1"):
        bundle = get_bundle(name)
        assert bundle.version and bundle.changelog
        assert bundle.system
        rendered = bundle.render("q", "jur:ng-kd", "- ev1")
        assert "q" in rendered and "jur:ng-kd" in rendered and "ev1" in rendered


def test_bundle_versions_are_unique_per_name():
    assert len({b.name for b in BUNDLES.values()}) == len(BUNDLES)
