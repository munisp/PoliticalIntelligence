"""Model/prompt regression harness: golden Q&A scoring must pass offline."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app import regression
from app.main import app


def test_golden_set_size():
    assert len(regression.GOLDEN_QA) == 10
    for spec in regression.GOLDEN_QA:
        assert spec["q"] and spec["expected_domains"]


def test_regression_run_scores():
    report = regression.run_regression()
    assert len(report.questions) == 10
    for q in report.questions:
        # contract completeness + determinism must hold for every question
        assert q.contract_complete, f"contract incomplete: {q.question}"
        assert q.deterministic, f"non-deterministic answer: {q.question}"
    # citation presence must hold for the clear majority of golden questions
    cited = sum(1 for q in report.questions if q.citations_present)
    assert cited >= 7, f"only {cited}/10 answers carry expected citations"
    assert report.pass_rate >= 0.7


def test_regression_latest_endpoint():
    client = TestClient(app)
    resp = client.get("/v1/regression/latest")
    assert resp.status_code == 200
    body = resp.json()
    assert body["data"]["questions_total"] == 10
    assert 0.0 <= body["data"]["pass_rate"] <= 1.0
    assert body["meta"]["request_id"]
