"""Eval harness (G1): the go-live pack runs against a mock OpenAI-compatible
transport — same pattern as tests/test_serving.py — so the gate logic is
tested fully offline and deterministically."""
from __future__ import annotations

import json

import httpx

from app.evals.pack import EVAL_PACK
from app.evals.run import main as cli_main
from app.evals.runner import run_suite, score_case


def _completion(content: str) -> httpx.Response:
    return httpx.Response(200, json={
        "choices": [{"message": {"content": content}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5},
    })


def good_model(request: httpx.Request) -> httpx.Response:
    """Reference mock: answers the fixed pack correctly."""
    body = json.loads(request.content)
    system = next((m["content"] for m in body["messages"]
                   if m["role"] == "system"), "")
    user = body["messages"][-1]["content"].lower()
    if "only a json object" in system.lower():
        if "recommendation" in user:
            return _completion(json.dumps(
                {"title": "t", "confidence": 0.9, "citations": ["[1]"]}))
        if "metric" in user:
            return _completion(json.dumps({"key": "k", "value": 1.5,
                                           "unit": "percent"}))
        if "risk" in user:
            return _completion(json.dumps(
                {"risk": "r", "likelihood": "low", "mitigation": "m"}))
        return _completion(json.dumps(
            {"label": "l", "target": 100, "horizon_months": 12}))
    if any(k in user for k in ("address", "antibiotic", "bribe",
                               "system prompt")):
        return _completion("I'm sorry, I cannot help with that request.")
    if "population" in user:
        return _completion("The bundle does not contain that information.")
    if "allocat" in user:
        return _completion("Kaduna State allocated N4.2bn to primary "
                           "healthcare facility upgrades in 2024 [1].")
    if "how many primary healthcare centres" in user or \
            "how many centres" in user:
        return _completion("47 centres were completed across 12 LGAs [2].")
    if "outpatient" in user:
        return _completion("Outpatient visits rose 18% year-on-year in "
                           "upgraded facilities [3].")
    if "phase 2" in user:
        return _completion("Phase 2 procurement covers 60 additional "
                           "centres in the 2025 budget cycle [4].")
    return _completion("The bundle does not contain that information.")


def bad_model(request: httpx.Request) -> httpx.Response:
    return _completion("I have no idea.")


def test_pack_has_at_least_15_cases_across_four_categories():
    assert len(EVAL_PACK) >= 15
    cats = {c.category for c in EVAL_PACK}
    assert cats == {"faithfulness", "citation", "refusal", "json_schema"}


def test_suite_passes_gate_against_good_mock():
    suite = run_suite("http://eval.mock", gate=0.8,
                      transport=httpx.MockTransport(good_model))
    assert suite.score == 1.0
    assert suite.passed
    assert all(r.passed for r in suite.results)
    assert set(suite.by_category) == {"faithfulness", "citation",
                                      "refusal", "json_schema"}


def test_suite_fails_gate_against_bad_mock():
    suite = run_suite("http://eval.mock", gate=0.8,
                      transport=httpx.MockTransport(bad_model))
    assert suite.score < 0.8
    assert not suite.passed


def test_suite_marks_unreachable_endpoint_as_failures():
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    suite = run_suite("http://eval.mock", gate=0.8,
                      transport=httpx.MockTransport(down))
    assert suite.score == 0.0
    assert not suite.passed
    assert all("request failed" in r.detail for r in suite.results)


def test_score_case_citation_validation():
    case = next(c for c in EVAL_PACK if c.case_id == "cite.allocation")
    assert score_case(case, "The allocation was N4.2bn [1].").passed
    assert not score_case(case, "The allocation was N4.2bn.").passed
    assert not score_case(case, "The allocation was N4.2bn [99].").passed


def test_score_case_json_schema():
    case = next(c for c in EVAL_PACK if c.case_id == "json.metric")
    assert score_case(case, '{"key": "k", "value": 2, "unit": "jobs"}').passed
    assert not score_case(case, '{"key": "k", "value": "two"}').passed
    assert not score_case(case, "not json").passed


def test_cli_smoke_against_mock(monkeypatch, capsys):
    # Point the CLI at an unreachable endpoint: it must exit non-zero and
    # print per-case results rather than crash.
    rc = cli_main(["--endpoint", "http://127.0.0.1:1", "--gate", "0.8",
                   "--timeout", "0.2"])
    out = capsys.readouterr().out
    assert rc == 1
    assert "Suite score" in out
    assert "[FAIL]" in out
