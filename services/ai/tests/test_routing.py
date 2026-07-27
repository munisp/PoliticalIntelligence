"""LLM routing: policy mapping, fallback chain, offline mode, audit."""
from __future__ import annotations

import httpx
import pytest

from app.llm import router as router_module
from app.llm.router import ModelRouter, RoutingAuditLog
from app.models import ModelTier, WorkloadClass


def test_policy_routing_by_workload_class():
    router = ModelRouter(base_url=None)
    cases = {
        "interactive_copilot": (ModelTier.qwen3_32b, "interactive"),
        "premium_synthesis": (ModelTier.qwen3_235b, "interactive"),
        "hard_analysis": (ModelTier.deepseek_r1, "interactive"),
        "batch": (ModelTier.qwen3_small, "batch"),
    }
    for workload, (tier, queue) in cases.items():
        meta, chain = router.route(workload)
        assert meta.workload_class == WorkloadClass(workload)
        assert meta.queue == queue
        assert chain[0] == tier
        assert meta.prompt_bundle
        assert meta.decision_id


def test_offline_when_no_endpoint_configured():
    audit = RoutingAuditLog()
    original = router_module.audit_log
    router_module.audit_log = audit
    try:
        router = ModelRouter(base_url=None)
        text, meta = router.generate("interactive_copilot", "hello")
        assert text is None
        assert meta.offline is True
        assert meta.selected_tier == ModelTier.offline
        assert meta.endpoint == "offline"
        entries = audit.list()
        assert entries and entries[-1].offline is True
    finally:
        router_module.audit_log = original


def test_fallback_chain_on_timeout(monkeypatch):
    calls: list[str] = []

    def fake_post(url, json=None, headers=None, timeout=None):
        calls.append(json["model"])
        raise httpx.TimeoutException("simulated timeout")

    monkeypatch.setattr(router_module.httpx, "post", fake_post)
    router = ModelRouter(base_url="http://vllm.fake", timeout=0.01)
    text, meta = router.generate("hard_analysis", "prove x")
    assert text is None
    assert meta.offline is True
    assert meta.fallback_used is True
    # deepseek-r1 -> qwen3-235b -> qwen3-32b all attempted
    attempted = [a["tier"] for a in meta.attempts]
    assert attempted == ["deepseek-r1", "qwen3-235b-a22b", "qwen3-32b"]
    assert len(calls) == 3


def test_fallback_second_tier_succeeds(monkeypatch):
    def fake_post(url, json=None, headers=None, timeout=None):
        model = json["model"]
        if model.startswith("deepseek"):
            raise httpx.ConnectError("down")
        request = httpx.Request("POST", url)
        return httpx.Response(
            200, request=request,
            json={"choices": [{"message": {"content": "analysis-ok"}}]})

    monkeypatch.setattr(router_module.httpx, "post", fake_post)
    router = ModelRouter(base_url="http://vllm.fake")
    text, meta = router.generate("hard_analysis", "analyze")
    assert text == "analysis-ok"
    assert meta.fallback_used is True
    assert meta.selected_tier == ModelTier.qwen3_235b
    assert meta.attempts[0]["outcome"].startswith("failed")


def test_canary_version_assigned_for_premium():
    router = ModelRouter(base_url=None)
    seen = set()
    for _ in range(20):
        meta, _ = router.route("premium_synthesis")
        seen.add(meta.canary_model_version)
    # every premium request gets a stable-or-canary version tag
    assert seen <= {"qwen3-235b-a22b@2024-09", "qwen3-235b-a22b@2024-12-canary"}
    assert seen  # non-empty


def test_no_canary_for_non_premium():
    router = ModelRouter(base_url=None)
    meta, _ = router.route("interactive_copilot")
    assert meta.canary_model_version is None
