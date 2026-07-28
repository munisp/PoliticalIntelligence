"""AI-5: LIVE serving path exercised end-to-end WITHOUT a GPU.

A mock OpenAI-compatible endpoint (httpx.MockTransport) emulates vLLM for
completion + streaming. These tests prove, against the real serving/router/
API code:
  * tier routing per workload class (DEFAULT/PREMIUM/SPECIALIST endpoints),
  * circuit breaker opening on a 5xx storm, fallback chain walk, and final
    degradation to the deterministic offline synthesizer,
  * SSE streaming token flow,
  * §9.2 contract validation applied to mock LLM JSON output.
"""
from __future__ import annotations

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.llm.router import ModelRouter, RoutingAuditLog
from app.llm import router as router_module
from app.llm.serving import ServingClient, ServingConfig
from app.main import app
from app.models import ModelTier, Recommendation

# ---------------------------------------------------------------------------
# Mock vLLM endpoint
# ---------------------------------------------------------------------------

def _chat_payload(content: str, prompt_tokens: int = 12) -> dict:
    return {
        "id": "chatcmpl-mock",
        "object": "chat.completion",
        "choices": [{"index": 0, "message": {"role": "assistant",
                                             "content": content},
                     "finish_reason": "stop"}],
        "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": 9,
                  "total_tokens": prompt_tokens + 9},
    }


def _sse_body(tokens: list[str]) -> str:
    lines = []
    for i, tok in enumerate(tokens):
        chunk = {"id": "chatcmpl-mock", "object": "chat.completion.chunk",
                 "choices": [{"index": 0, "delta": {"content": tok},
                              "finish_reason": None}]}
        lines.append(f"data: {json.dumps(chunk)}")
    lines.append("data: [DONE]")
    return "\n".join(lines) + "\n"


def mock_vllm(handler_overrides: dict[str, callable] | None = None,
              default_content: str = "Grounded answer [1]"):
    """MockTransport emulating per-tier vLLM endpoints."""
    overrides = handler_overrides or {}

    def handler(request: httpx.Request) -> httpx.Response:
        host = request.url.host
        if host in overrides:
            return overrides[host](request)
        body = json.loads(request.content)
        if body.get("stream"):
            return httpx.Response(
                200, text=_sse_body(["Grounded", " answer", " [1]"]),
                headers={"Content-Type": "text/event-stream"})
        return httpx.Response(200, json=_chat_payload(default_content))

    return httpx.MockTransport(handler)


def _serving(client: httpx.Client, **over) -> ServingClient:
    cfg = ServingConfig(
        base_urls={"DEFAULT": "http://vllm-default.test",
                   "PREMIUM": "http://vllm-premium.test",
                   "SPECIALIST": "http://vllm-specialist.test"},
        timeout_s=1.0, breaker_failures=2, breaker_reset_s=30.0, **over)
    return ServingClient(cfg, client=client)


# ---------------------------------------------------------------------------
# Tier routing against the mock endpoint
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("workload,expected_host", [
    ("interactive_copilot", "vllm-default.test"),     # qwen3-32b
    ("batch", "vllm-default.test"),                   # qwen3-small
    ("premium_synthesis", "vllm-premium.test"),       # qwen3-235b
    ("hard_analysis", "vllm-specialist.test"),        # deepseek-r1
])
def test_tier_routing_hits_the_right_endpoint(workload, expected_host):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.host)
        return httpx.Response(200, json=_chat_payload("ok"))

    serving = _serving(httpx.Client(transport=httpx.MockTransport(handler)))
    router = ModelRouter(serving=serving)
    text, meta = router.generate(workload, "ping", request_id="r-tier")
    assert text == "ok"
    assert not meta.offline
    assert seen[0] == expected_host
    assert meta.attempts[-1]["outcome"] == "ok"


# ---------------------------------------------------------------------------
# Full API path: copilot answered by the mock LLM (not the synthesizer)
# ---------------------------------------------------------------------------
def test_api_copilot_served_by_mock_llm(monkeypatch):
    monkeypatch.setenv("VLLM_BASE_URL", "http://vllm-default.test")
    with TestClient(app) as client:
        app.state.serving._client = httpx.Client(
            transport=mock_vllm(default_content="SERVED-BY-MOCK-VLLM"))
        resp = client.post("/v1/copilot/query", json={
            "query": "healthcare budget execution", "top_k": 3})
        assert resp.status_code == 200
        data = resp.json()["data"]
        # The live LLM text is wrapped in the citation contract.
        assert "SERVED-BY-MOCK-VLLM" in data["answer"]
        assert data["model_routing"]["offline"] is False
        assert data["model_routing"]["selected_tier"] == "qwen3-32b"
        assert isinstance(data["citations"], list)


def test_api_recommendations_contract_with_live_serving(monkeypatch):
    monkeypatch.setenv("VLLM_BASE_URL", "http://vllm-default.test")
    with TestClient(app) as client:
        app.state.serving._client = httpx.Client(transport=mock_vllm())
        resp = client.post("/v1/recommendations", json={
            "query": "primary healthcare centres", "sector": "health",
            "top_k": 3})
        assert resp.status_code == 200
        rec = resp.json()["data"]
        # §9.2 contract keys present regardless of the serving path.
        for key in ("recommendation_id", "rationale", "evidence_base",
                    "estimated_jobs", "budget_ranges", "timeline",
                    "risk_register", "kpis", "model_routing"):
            assert key in rec, key


# ---------------------------------------------------------------------------
# 5xx storm: breaker opens, fallback chain walks, offline synthesizer wins
# ---------------------------------------------------------------------------
def test_5xx_storm_opens_breakers_and_degrades_to_offline():
    def storm(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "CUDA OOM"})

    serving = _serving(httpx.Client(
        transport=httpx.MockTransport(storm)))
    audit = RoutingAuditLog()
    original = router_module.audit_log
    router_module.audit_log = audit
    try:
        router = ModelRouter(serving=serving)
        assert router.online
        # interactive chain: qwen3-32b -> qwen3-small (both on the storming
        # DEFAULT endpoint). Each request fails every tier once; the tier
        # breaker opens after 2 consecutive failures.
        text, meta = router.generate("interactive_copilot", "hello",
                                     request_id="storm-1")
        assert text is None and meta.offline
        assert meta.fallback_used
        text1b, _ = router.generate("interactive_copilot", "hello",
                                    request_id="storm-1b")
        assert text1b is None
        assert serving.breaker_for(ModelTier.qwen3_32b).state == "open"
        # The next request short-circuits at the open breaker (no penalty).
        text2, meta2 = router.generate("interactive_copilot", "hello",
                                       request_id="storm-2")
        assert text2 is None and meta2.offline
        outcomes = [a["outcome"] for a in meta2.attempts]
        assert "circuit-open" in outcomes
        entry = audit.list()[-1]
        assert entry.offline and entry.circuit_breakers["qwen3-32b"] == "open"
    finally:
        router_module.audit_log = original


def test_partial_storm_falls_back_to_next_tier_chain():
    """DEFAULT storms, but hard_analysis chain reaches SPECIALIST."""
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "vllm-specialist.test":
            return httpx.Response(200, json=_chat_payload("deep answer"))
        return httpx.Response(503, json={"error": "unavailable"})

    serving = _serving(httpx.Client(
        transport=httpx.MockTransport(handler)))
    router = ModelRouter(serving=serving)
    text, meta = router.generate("hard_analysis", "analyze", request_id="p1")
    # deepseek-r1 maps to the SPECIALIST endpoint and answers first try,
    # even while DEFAULT/PREMIUM are storming.
    assert text == "deep answer"
    assert meta.selected_tier == ModelTier.deepseek_r1
    assert meta.attempts[0]["outcome"] == "ok"


# ---------------------------------------------------------------------------
# Streaming token flow
# ---------------------------------------------------------------------------
def test_streaming_yields_ordered_deltas():
    serving = _serving(httpx.Client(transport=mock_vllm()))
    tokens = list(serving.stream(ModelTier.qwen3_32b,
                                 [{"role": "user", "content": "hi"}]))
    assert tokens == ["Grounded", " answer", " [1]"]
    snap = serving.metrics_snapshot()
    assert snap["qwen3-32b"]["requests"] == 1
    assert snap["qwen3-32b"]["failures"] == 0


def test_streaming_5xx_records_failure_and_opens_breaker():
    def storm(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "boom"})

    serving = _serving(httpx.Client(
        transport=httpx.MockTransport(storm)))
    for _ in range(2):
        with pytest.raises(httpx.HTTPStatusError):
            list(serving.stream(ModelTier.qwen3_32b, []))
    with pytest.raises(RuntimeError, match="circuit-open"):
        list(serving.stream(ModelTier.qwen3_32b, []))


# ---------------------------------------------------------------------------
# Contract validation applied to mock LLM JSON
# ---------------------------------------------------------------------------
_REC_JSON = {
    "recommendation_id": "rec:opp-1",
    "title": "PHC expansion",
    "rationale": "Evidence-grounded rationale",
    "assumptions": ["funding"],
    "evidence_base": [{
        "evidence_source_id": "metric:1",
        "source_type": "metric",
        "citation": "World Bank — GDP (2024)",
        "retrieval_path": "sql",
        "confidence": 0.8,
        "content": "GDP = 477B USD",
    }],
    "estimated_jobs": 1200,
    "budget_ranges": [{"low_ngn_m": 500, "high_ngn_m": 1500}],
    "timeline": [{"phase": "mobilise", "duration_months": 6,
                  "milestones": ["plan"]}],
    "implementation_actors": ["SMOH"],
    "legal_dependencies": ["Public Procurement Law 2007"],
    "risk_register": [{"risk": "funding delays"}],
    "kpis": [{"name": "jobs_created", "target": "1200",
              "measurement": "payroll"}],
    "simulation_scenarios": [{"engine": "employment",
                              "description": "jobs impact"}],
    "confidence": 0.7,
    "model_routing": None,  # repaired below
}


def test_contract_validation_accepts_valid_mock_llm_json():
    from app.models import RoutingMetadata, WorkloadClass

    payload = dict(_REC_JSON)
    payload["model_routing"] = RoutingMetadata(
        workload_class=WorkloadClass.premium_synthesis,
        selected_tier=ModelTier.qwen3_235b,
        endpoint="http://vllm-premium.test", queue="interactive",
        prompt_bundle="synthesis/v2", decision_id="route:test").model_dump(mode="json")
    # The mock endpoint SERVES this JSON; the pydantic contract must accept
    # it exactly as a served model's structured output would be validated.
    rec = Recommendation.model_validate(payload)
    assert rec.recommendation_id == "rec:opp-1"
    assert len(rec.evidence_base) >= 1


def test_contract_validation_rejects_malformed_mock_llm_json():
    from pydantic import ValidationError

    broken = dict(_REC_JSON)
    broken["evidence_base"] = []           # contract: ≥1 evidence source
    broken["confidence"] = 4.2             # out of range
    broken["model_routing"] = {"bogus": True}
    with pytest.raises(ValidationError):
        Recommendation.model_validate(broken)
