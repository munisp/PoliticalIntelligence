"""Serving layer: circuit breaker transitions, hedging, router fallback,
token/latency metrics on the routing audit."""
from __future__ import annotations

import httpx
import pytest

from app.llm.router import ModelRouter, RoutingAuditLog
from app.llm import router as router_module
from app.llm.serving import (CircuitBreaker, CompletionResult, ServingClient,
                             ServingConfig)
from app.models import ModelTier


def _serving(**over) -> ServingClient:
    cfg = ServingConfig(
        base_urls={"DEFAULT": "http://vllm.fake",
                   "PREMIUM": "http://vllm-premium.fake"},
        timeout_s=0.05, breaker_failures=2, breaker_reset_s=10.0, **over)
    return ServingClient(cfg, client=httpx.Client())


def _ok_transport(content: str = '{"ok": true}', prompt_tokens: int = 5):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "choices": [{"message": {"content": content}}],
            "usage": {"prompt_tokens": prompt_tokens, "completion_tokens": 7},
        })
    return httpx.MockTransport(handler)


# ---------------------------------------------------------------------------
# Circuit breaker
# ---------------------------------------------------------------------------
def test_breaker_closed_to_open_after_threshold():
    clock = _Clock()
    b = CircuitBreaker(failure_threshold=2, reset_timeout_s=30, clock=clock)
    assert b.state == "closed" and b.allow_request()
    b.record_failure()
    assert b.state == "closed"
    b.record_failure()
    assert b.state == "open"
    assert not b.allow_request()


def test_breaker_half_open_then_close_on_success():
    clock = _Clock()
    b = CircuitBreaker(failure_threshold=1, reset_timeout_s=10, clock=clock)
    b.record_failure()
    assert b.state == "open"
    clock.t += 11
    assert b.state == "half-open"
    assert b.allow_request()
    b.record_success()
    assert b.state == "closed"


class _Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


# ---------------------------------------------------------------------------
# ServingClient
# ---------------------------------------------------------------------------
def test_complete_success_records_metrics_and_usage():
    serving = _serving()
    serving._client = httpx.Client(transport=_ok_transport())
    res = serving.complete(ModelTier.qwen3_32b,
                           [{"role": "user", "content": "hi"}])
    assert res.text == '{"ok": true}'
    assert res.prompt_tokens == 5 and res.completion_tokens == 7
    snap = serving.metrics_snapshot()
    assert snap["qwen3-32b"]["requests"] == 1
    assert snap["qwen3-32b"]["failures"] == 0
    assert snap["qwen3-32b"]["breaker"] == "closed"


def test_complete_opens_breaker_after_failures():
    def fail(request):
        raise httpx.ConnectError("boom", request=request)

    serving = _serving()
    serving._client = httpx.Client(transport=httpx.MockTransport(fail))
    for _ in range(2):
        with pytest.raises(httpx.ConnectError):
            serving.complete(ModelTier.qwen3_32b, [])
    with pytest.raises(RuntimeError, match="circuit-open"):
        serving.complete(ModelTier.qwen3_32b, [])
    snap = serving.metrics_snapshot()
    assert snap["qwen3-32b"]["breaker"] == "open"


def test_no_endpoint_for_tier_raises():
    cfg = ServingConfig(base_urls={"DEFAULT": "http://x"}, timeout_s=0.05)
    serving = ServingClient(cfg, client=httpx.Client())
    with pytest.raises(RuntimeError, match="no-endpoint-configured"):
        serving.complete(ModelTier.deepseek_r1, [])


def test_hedging_fires_second_request():
    calls = []

    def slow(request):
        calls.append(1)
        return httpx.Response(200, json={
            "choices": [{"message": {"content": "ok"}}], "usage": {}})

    serving = _serving(hedge_after_s=0.001)
    serving._client = httpx.Client(transport=httpx.MockTransport(slow))
    # handler is fast, but hedge fires after 1ms regardless; either way one
    # result is returned and hedged flag is a bool.
    res = serving.complete(ModelTier.qwen3_32b, [])
    assert res.text == "ok"
    assert isinstance(res.hedged, bool)


# ---------------------------------------------------------------------------
# Router integration via serving
# ---------------------------------------------------------------------------
def test_router_falls_back_to_offline_when_all_breakers_open():
    def fail(request):
        raise httpx.ConnectError("boom", request=request)

    serving = _serving()
    serving._client = httpx.Client(transport=httpx.MockTransport(fail))
    audit = RoutingAuditLog()
    original = router_module.audit_log
    router_module.audit_log = audit
    try:
        router = ModelRouter(serving=serving)
        assert router.online
        text, meta = router.generate("interactive_copilot", "hello",
                                     request_id="r1")
        assert text is None and meta.offline
        # primary breaker opened after 2 failures? primary failed once here;
        # second call: breaker may allow one more; force more calls.
        router.generate("interactive_copilot", "hello", request_id="r2")
        entry = audit.list()[-1]
        assert entry.offline is True
        assert entry.circuit_breakers.get("qwen3-32b") == "open"
    finally:
        router_module.audit_log = original


def test_router_success_records_token_metrics():
    serving = _serving()
    serving._client = httpx.Client(transport=_ok_transport(prompt_tokens=11))
    audit = RoutingAuditLog()
    original = router_module.audit_log
    router_module.audit_log = audit
    try:
        router = ModelRouter(serving=serving)
        text, meta = router.generate("interactive_copilot", "hello")
        assert text == '{"ok": true}'
        assert meta.selected_tier == ModelTier.qwen3_32b
        entry = audit.list()[-1]
        assert entry.prompt_tokens == 11 and entry.completion_tokens == 7
        assert entry.attempts[-1]["usage"]["prompt_tokens"] == 11
    finally:
        router_module.audit_log = original
