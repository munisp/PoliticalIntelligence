"""G1 go-live switch: a single env var (LLM_REMOTE_BASE_URL) flips the
default tier offline -> remote; when the remote tier's circuit breaker is
open the router falls back to the offline synthesizer."""
from __future__ import annotations

import httpx

from app.config import Settings
from app.llm.router import ModelRouter
from app.llm.serving import ServingClient, ServingConfig
from app.models import ModelTier


def test_llm_remote_base_url_alias_flips_tier(monkeypatch):
    monkeypatch.delenv("VLLM_BASE_URL", raising=False)
    monkeypatch.setenv("LLM_REMOTE_BASE_URL", "http://vllm-qwen3-8b:8000")
    assert Settings.from_env().vllm_base_url == "http://vllm-qwen3-8b:8000"
    cfg = ServingConfig.from_env()
    assert cfg.base_urls["DEFAULT"] == "http://vllm-qwen3-8b:8000"
    assert ServingClient(cfg).configured


def test_vllm_base_url_takes_precedence(monkeypatch):
    monkeypatch.setenv("VLLM_BASE_URL", "http://a")
    monkeypatch.setenv("LLM_REMOTE_BASE_URL", "http://b")
    assert Settings.from_env().vllm_base_url == "http://a"
    assert ServingConfig.from_env().base_urls["DEFAULT"] == "http://a"


def test_unset_env_stays_offline(monkeypatch):
    for var in ("VLLM_BASE_URL", "LLM_REMOTE_BASE_URL",
                    "VLLM_BASE_URL_DEFAULT"):
        monkeypatch.delenv(var, raising=False)
    router = ModelRouter(serving=ServingClient(ServingConfig.from_env()))
    text, meta = router.generate("interactive_copilot", "hi")
    assert text is None and meta.offline
    assert meta.selected_tier is ModelTier.offline


def test_breaker_open_falls_back_to_offline():
    def always_fail(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down")

    serving = ServingClient(
        ServingConfig(base_urls={"DEFAULT": "http://vllm.fake"},
                      breaker_failures=1, breaker_reset_s=60),
        client=httpx.Client(transport=httpx.MockTransport(always_fail)))
    router = ModelRouter(serving=serving)
    # First call: remote attempt fails -> breaker opens -> offline.
    text1, meta1 = router.generate("interactive_copilot", "hi")
    assert text1 is None and meta1.offline
    assert serving.breaker_for(ModelTier.qwen3_32b).state == "open"
    # Second call: breaker open, tier skipped without a network attempt.
    text2, meta2 = router.generate("interactive_copilot", "hi")
    assert text2 is None and meta2.offline
    assert any(a.get("outcome") == "circuit-open"
               for a in meta2.attempts)
