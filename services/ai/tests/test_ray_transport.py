"""AI-7: ray transport adapter + Ray Serve deployment config.

All tests run WITHOUT ray installed: the transport adapter is plain HTTP
(httpx MockTransport), and ray_serve tier configs are pure data.
"""
from __future__ import annotations

import httpx
import pytest

from app.llm import ray_serve
from app.llm.serving import RAY_CHAT_PATH, ServingClient, ServingConfig
from app.models import ModelTier


def _ok_transport(content: str = '{"ok": true}'):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "choices": [{"message": {"content": content}}],
            "usage": {"prompt_tokens": 5, "completion_tokens": 7},
        })
    return httpx.MockTransport(handler)


# -- transport selection -------------------------------------------------------
def test_transport_defaults_to_vllm(monkeypatch):
    for v in ("LLM_TRANSPORT", "VLLM_BASE_URL", "RAY_SERVE_URL"):
        monkeypatch.delenv(v, raising=False)
    monkeypatch.setenv("VLLM_BASE_URL", "http://vllm:8000/v1")
    cfg = ServingConfig.from_env()
    assert cfg.transport == "vllm"
    assert cfg.chat_path == "/v1/chat/completions"
    assert cfg.base_urls["DEFAULT"] == "http://vllm:8000/v1"


def test_transport_ray_resolves_ray_serve_urls(monkeypatch):
    monkeypatch.setenv("LLM_TRANSPORT", "ray")
    monkeypatch.setenv("RAY_SERVE_URL", "http://policy-twin-ray-serve:8000")
    monkeypatch.setenv("RAY_SERVE_URL_PREMIUM", "http://ray-premium:8000")
    cfg = ServingConfig.from_env()
    assert cfg.transport == "ray"
    assert cfg.chat_path == RAY_CHAT_PATH == "/v1/llm/chat/completions"
    assert cfg.base_urls["DEFAULT"] == "http://policy-twin-ray-serve:8000"
    assert cfg.base_urls["PREMIUM"] == "http://ray-premium:8000"
    assert cfg.base_urls["SPECIALIST"] == "http://policy-twin-ray-serve:8000"


def test_transport_invalid_rejected(monkeypatch):
    monkeypatch.setenv("LLM_TRANSPORT", "grpc")
    with pytest.raises(ValueError, match="LLM_TRANSPORT"):
        ServingConfig.from_env()


# -- ray transport round-trip (mock endpoint) ----------------------------------
def test_complete_over_ray_transport():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["path"] = request.url.path
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(200, json={
            "choices": [{"message": {"content": "ray says hi"}}],
            "usage": {"prompt_tokens": 3, "completion_tokens": 4},
        })

    cfg = ServingConfig(
        base_urls={"DEFAULT": "http://ray-head:8000"},
        transport="ray",
        api_key="test-key",
    )
    client = ServingClient(cfg, client=httpx.Client(
        transport=httpx.MockTransport(handler)))
    result = client.complete(
        ModelTier.qwen3_32b, [{"role": "user", "content": "hi"}])
    assert result.text == "ray says hi"
    assert result.prompt_tokens == 3
    assert seen["path"] == "/v1/llm/chat/completions"
    assert seen["auth"] == "Bearer test-key"


def test_ray_transport_breaker_fallback_unchanged():
    # open the breaker with failures; complete() must raise circuit-open so
    # the router falls back exactly as with vllm transport
    def failing(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "boom"})

    cfg = ServingConfig(
        base_urls={"DEFAULT": "http://ray-head:8000"},
        transport="ray", breaker_failures=2, breaker_reset_s=30,
    )
    client = ServingClient(cfg, client=httpx.Client(
        transport=httpx.MockTransport(failing)))
    for _ in range(2):
        with pytest.raises(httpx.HTTPStatusError):
            client.complete(ModelTier.qwen3_32b, [{"role": "user", "content": "x"}])
    with pytest.raises(RuntimeError, match="circuit-open"):
        client.complete(ModelTier.qwen3_32b, [{"role": "user", "content": "x"}])


# -- deployment configs (pure data) ---------------------------------------------
def test_tier_deployments_cover_serving_tiers():
    assert set(ray_serve.TIER_DEPLOYMENTS) == {"DEFAULT", "PREMIUM", "SPECIALIST"}
    d = ray_serve.TIER_DEPLOYMENTS["DEFAULT"]
    assert d.route == "/v1/llm/chat/completions"
    assert d.num_gpus_per_replica == 1
    assert d.min_replicas >= 1  # interactive tier always warm
    assert d.queue_separation == "interactive"
    auto = d.autoscaling_config()
    assert auto["min_replicas"] == d.min_replicas
    assert auto["max_replicas"] == d.max_replicas
    opts = d.ray_actor_options()
    assert opts["num_gpus"] == 1
    assert any("interactive" in k for k in opts["resources"])


def test_premium_tier_uses_tensor_parallel_gpus():
    p = ray_serve.TIER_DEPLOYMENTS["PREMIUM"]
    assert p.num_gpus_per_replica == 2
    assert p.queue_separation == "premium"


def test_ray_not_installed_guard(monkeypatch):
    assert ray_serve.ray_available() is False  # sandbox has no ray
    with pytest.raises(RuntimeError, match="ray\[serve\] is not installed"):
        ray_serve.build_deployments()
