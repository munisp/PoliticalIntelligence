"""Production vLLM serving glue (docs/LLM.md, spec section 21).

- Per-tier OpenAI-compatible endpoints, resolved from
  VLLM_BASE_URL_{DEFAULT,PREMIUM,SPECIALIST} with fallback to VLLM_BASE_URL
  (tier mapping: DEFAULT -> qwen3-32b / qwen3-small, PREMIUM -> qwen3-235b,
  SPECIALIST -> deepseek-r1).
- Connection pooling via a shared httpx.Client (lazy, thread-safe).
- Streaming support for the interactive tier (SSE `stream=true`).
- Request hedging: a duplicate request is fired when the primary exceeds the
  hedging delay (p95 estimate, default LLM_HEDGE_AFTER_MS); first to finish
  wins, the loser is abandoned.
- Circuit breaker per tier: opens after N consecutive failures
  (LLM_BREAKER_FAILURES, default 3), stays open for LLM_BREAKER_RESET_SECONDS
  (default 30), then half-opens and closes on the first success. While a
  tier's breaker is open the router walks the fallback chain and finally the
  deterministic offline synthesizer.
- Metrics: per-tier request counts, failures, and a latency ring (plus token
  usage attached to each completion and to the routing audit entry).
"""
from __future__ import annotations

import json
import os
import threading
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from dataclasses import dataclass, field
from typing import Any, Iterator

import httpx

from app.logging_setup import get_logger
from app.models import ModelTier

log = get_logger("llm.serving")

CHAT_PATH = "/v1/chat/completions"
# AI-7: Ray Serve deployments mount the OpenAI schema at /v1/llm
# (route prefix, see app/llm/ray_serve.py) — no extra /v1 segment.
RAY_CHAT_PATH = "/v1/llm/chat/completions"

# Model tier -> environment tier name for endpoint resolution.
TIER_ENV: dict[ModelTier, str] = {
    ModelTier.qwen3_32b: "DEFAULT",
    ModelTier.qwen3_small: "DEFAULT",
    ModelTier.qwen3_235b: "PREMIUM",
    ModelTier.deepseek_r1: "SPECIALIST",
}

LATENCY_RING = 200


# ---------------------------------------------------------------------------
# Circuit breaker
# ---------------------------------------------------------------------------
class CircuitBreaker:
    """closed -> open (after failure_threshold consecutive failures)
    -> half-open (after reset_timeout_s) -> closed (on success)."""

    def __init__(self, failure_threshold: int = 3, reset_timeout_s: float = 30.0,
                 clock=time.monotonic):
        self.failure_threshold = failure_threshold
        self.reset_timeout_s = reset_timeout_s
        self._clock = clock
        self._failures = 0
        self._opened_at: float | None = None
        self._lock = threading.Lock()

    @property
    def state(self) -> str:
        with self._lock:
            if self._opened_at is None:
                return "closed"
            if self._clock() - self._opened_at >= self.reset_timeout_s:
                return "half-open"
            return "open"

    def allow_request(self) -> bool:
        return self.state != "open"

    def record_success(self) -> None:
        with self._lock:
            self._failures = 0
            self._opened_at = None

    def record_failure(self) -> None:
        with self._lock:
            self._failures += 1
            if self._failures >= self.failure_threshold and self._opened_at is None:
                self._opened_at = self._clock()
                log.warning("circuit breaker opened",
                            extra={"request_id": "-", "failures": self._failures})


# ---------------------------------------------------------------------------
# Results / config
# ---------------------------------------------------------------------------
@dataclass
class CompletionResult:
    text: str
    model: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    latency_ms: float = 0.0
    hedged: bool = False


@dataclass
class ServingConfig:
    base_urls: dict[str, str] = field(default_factory=dict)  # env tier -> url
    api_key: str | None = None
    timeout_s: float = 30.0
    hedge_after_s: float = 0.0       # 0 disables hedging
    breaker_failures: int = 3
    breaker_reset_s: float = 30.0
    # AI-7: serving transport. "vllm" (default): direct vLLM OpenAI servers
    # (VLLM_BASE_URL[_TIER]). "ray": Ray Serve deployments (RAY_SERVE_URL
    # [_TIER]) exposing the same OpenAI schema at route prefix /v1/llm.
    # Identical client interface either way; breakers/fallback unchanged.
    transport: str = "vllm"

    @property
    def chat_path(self) -> str:
        return RAY_CHAT_PATH if self.transport == "ray" else CHAT_PATH

    @classmethod
    def from_env(cls) -> "ServingConfig":
        transport = os.getenv("LLM_TRANSPORT", "vllm").strip().lower()
        if transport not in ("vllm", "ray"):
            raise ValueError(
                f"LLM_TRANSPORT must be 'vllm' or 'ray', got {transport!r}"
            )
        prefix = "RAY_SERVE_URL" if transport == "ray" else "VLLM_BASE_URL"
        key_var = "RAY_SERVE_API_KEY" if transport == "ray" else "VLLM_API_KEY"
        urls: dict[str, str] = {}
        # G1: LLM_REMOTE_BASE_URL is the documented go-live alias for the
        # default (vllm) transport — one env var flips offline -> remote;
        # the router's fallback chain + circuit breakers degrade back to
        # the offline synthesizer automatically (docs/GPU-GOLIVE.md).
        default = os.getenv(prefix)
        if not default and transport == "vllm":
            default = os.getenv("LLM_REMOTE_BASE_URL")
        for tier in ("DEFAULT", "PREMIUM", "SPECIALIST"):
            url = os.getenv(f"{prefix}_{tier}") or default
            if url:
                urls[tier] = url.rstrip("/")
        return cls(
            base_urls=urls,
            api_key=os.getenv(key_var),
            timeout_s=float(os.getenv("LLM_TIMEOUT_SECONDS", "30")),
            hedge_after_s=float(os.getenv("LLM_HEDGE_AFTER_MS", "0")) / 1000.0,
            breaker_failures=int(os.getenv("LLM_BREAKER_FAILURES", "3")),
            breaker_reset_s=float(os.getenv("LLM_BREAKER_RESET_SECONDS", "30")),
            transport=transport,
        )


# ---------------------------------------------------------------------------
# Serving client
# ---------------------------------------------------------------------------
class ServingClient:
    """Pooled, hedged, breaker-guarded OpenAI-compatible client."""

    def __init__(self, config: ServingConfig | None = None,
                 client: httpx.Client | None = None):
        self.config = config or ServingConfig.from_env()
        self._client = client
        self._client_lock = threading.Lock()
        self._breakers: dict[str, CircuitBreaker] = {}
        self._latencies: dict[str, deque[float]] = {}
        self._counts: dict[str, dict[str, int]] = {}
        self._hedge_pool = ThreadPoolExecutor(max_workers=4)
        self._metrics_lock = threading.Lock()

    # -- plumbing ----------------------------------------------------------
    @property
    def configured(self) -> bool:
        return bool(self.config.base_urls)

    def endpoint_for(self, tier: ModelTier) -> str | None:
        env_tier = TIER_ENV.get(tier)
        return self.config.base_urls.get(env_tier) if env_tier else None

    def breaker_for(self, tier: ModelTier) -> CircuitBreaker:
        key = tier.value
        if key not in self._breakers:
            self._breakers[key] = CircuitBreaker(
                self.config.breaker_failures, self.config.breaker_reset_s)
        return self._breakers[key]

    def _http(self) -> httpx.Client:
        if self._client is not None:
            return self._client
        with self._client_lock:
            if self._client is None:
                self._client = httpx.Client(
                    timeout=self.config.timeout_s,
                    limits=httpx.Limits(max_connections=32,
                                        max_keepalive_connections=16))
        return self._client

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"
        return headers

    # -- metrics ------------------------------------------------------------
    def _record(self, tier: ModelTier, ok: bool, latency_ms: float) -> None:
        with self._metrics_lock:
            c = self._counts.setdefault(tier.value, {"requests": 0, "failures": 0})
            c["requests"] += 1
            if not ok:
                c["failures"] += 1
            ring = self._latencies.setdefault(tier.value, deque(maxlen=LATENCY_RING))
            ring.append(latency_ms)

    def metrics_snapshot(self) -> dict[str, Any]:
        with self._metrics_lock:
            out: dict[str, Any] = {}
            for tier, c in self._counts.items():
                lat = sorted(self._latencies.get(tier, []))
                p95 = lat[int(0.95 * (len(lat) - 1))] if lat else 0.0
                out[tier] = {**c, "latency_p95_ms": round(p95, 2),
                             "breaker": self._breakers.get(tier) and
                             self._breakers[tier].state}
            return out

    # -- completion ---------------------------------------------------------
    def _post_once(self, url: str, body: dict[str, Any]) -> tuple[str, dict]:
        resp = self._http().post(url, json=body, headers=self._headers())
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"], data.get("usage", {})

    def complete(self, tier: ModelTier, messages: list[dict[str, str]],
                 model_version: str | None = None,
                 max_tokens: int = 2048, temperature: float = 0.1,
                 stream: bool = False) -> CompletionResult:
        """One completion against a tier, honoring its circuit breaker.

        Raises RuntimeError("circuit-open") when the breaker is open; raises
        the underlying httpx error on request failure (breaker is updated)."""
        base = self.endpoint_for(tier)
        if not base:
            raise RuntimeError("no-endpoint-configured")
        breaker = self.breaker_for(tier)
        if not breaker.allow_request():
            raise RuntimeError("circuit-open")
        body = {
            "model": model_version or tier.value,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        url = f"{base}{self.config.chat_path}"
        started = time.monotonic()
        try:
            if self.config.hedge_after_s > 0:
                text, usage, hedged = self._hedged_post(url, body)
            else:
                text, usage = self._post_once(url, body)
                hedged = False
            latency = (time.monotonic() - started) * 1000
            breaker.record_success()
            self._record(tier, True, latency)
            return CompletionResult(
                text=text, model=body["model"],
                prompt_tokens=int(usage.get("prompt_tokens", 0)),
                completion_tokens=int(usage.get("completion_tokens", 0)),
                latency_ms=round(latency, 2), hedged=hedged)
        except Exception:
            breaker.record_failure()
            self._record(tier, False, (time.monotonic() - started) * 1000)
            raise

    def _hedged_post(self, url: str, body: dict[str, Any]) -> tuple[str, dict, bool]:
        """Fire a duplicate request after hedge_after_s; first success wins."""
        primary = self._hedge_pool.submit(self._post_once, url, body)
        done, _ = wait({primary}, timeout=self.config.hedge_after_s)
        if done:
            text, usage = primary.result()
            return text, usage, False
        hedge = self._hedge_pool.submit(self._post_once, url, body)
        done, _pending = wait({primary, hedge}, return_when=FIRST_COMPLETED)
        for fut in done:
            exc = fut.exception()
            if exc is None:
                return *fut.result(), True
        # first finisher failed; wait for the other
        for fut in (primary, hedge):
            if fut not in done:
                text, usage = fut.result()
                return text, usage, True
        raise RuntimeError("hedge-unreachable")

    # -- streaming ------------------------------------------------------------
    def stream(self, tier: ModelTier, messages: list[dict[str, str]],
               model_version: str | None = None,
               max_tokens: int = 2048) -> Iterator[str]:
        """Yield content deltas (SSE stream=true) for the interactive tier."""
        base = self.endpoint_for(tier)
        if not base:
            raise RuntimeError("no-endpoint-configured")
        breaker = self.breaker_for(tier)
        if not breaker.allow_request():
            raise RuntimeError("circuit-open")
        body = {"model": model_version or tier.value, "messages": messages,
                "temperature": 0.1, "max_tokens": max_tokens, "stream": True}
        started = time.monotonic()
        try:
            with self._http().stream("POST", f"{base}{self.config.chat_path}", json=body,
                                     headers=self._headers()) as resp:
                resp.raise_for_status()
                for line in resp.iter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[len("data:"):].strip()
                    if data == "[DONE]":
                        break
                    chunk = json.loads(data)
                    delta = chunk["choices"][0].get("delta", {})
                    if delta.get("content"):
                        yield delta["content"]
            breaker.record_success()
            self._record(tier, True, (time.monotonic() - started) * 1000)
        except Exception:
            breaker.record_failure()
            self._record(tier, False, (time.monotonic() - started) * 1000)
            raise
