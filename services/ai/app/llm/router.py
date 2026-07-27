"""Model routing service (spec section 21).

- Policy-based routing by workload class to model tiers
- Queue separation: interactive vs batch
- Fallback chain on timeout / unavailability
- Canary configuration by model version + prompt bundle
- Every routing decision logged to an in-memory audit ring + structured logs
- OpenAI-compatible protocol against vLLM / Ray Serve endpoints
- Deterministic OFFLINE synthesizer when no endpoint is configured (the
  platform must be fully functional without GPUs)
"""
from __future__ import annotations

import threading
import time
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Any

import httpx

from app.config import settings
from app.logging_setup import get_logger
from app.models import (ModelTier, RoutingAuditEntry, RoutingMetadata,
                        WorkloadClass)

log = get_logger("llm.router")

# ---------------------------------------------------------------------------
# Routing policy
# ---------------------------------------------------------------------------
TIER_ENDPOINTS: dict[ModelTier, str] = {
    ModelTier.qwen3_32b: "/v1/chat/completions",
    ModelTier.qwen3_235b: "/v1/chat/completions",
    ModelTier.deepseek_r1: "/v1/chat/completions",
    ModelTier.qwen3_small: "/v1/chat/completions",
}

# workload class -> (primary tier, fallback chain, queue)
ROUTING_POLICY: dict[WorkloadClass, dict[str, Any]] = {
    WorkloadClass.interactive_copilot: {
        "primary": ModelTier.qwen3_32b,
        "fallbacks": [ModelTier.qwen3_small],
        "queue": "interactive",
        "prompt_bundle": "copilot/v3",
    },
    WorkloadClass.premium_synthesis: {
        "primary": ModelTier.qwen3_235b,
        "fallbacks": [ModelTier.qwen3_32b, ModelTier.qwen3_small],
        "queue": "interactive",
        "prompt_bundle": "synthesis/v2",
    },
    WorkloadClass.hard_analysis: {
        "primary": ModelTier.deepseek_r1,
        "fallbacks": [ModelTier.qwen3_235b, ModelTier.qwen3_32b],
        "queue": "interactive",
        "prompt_bundle": "analysis/v1",
    },
    WorkloadClass.batch: {
        "primary": ModelTier.qwen3_small,
        "fallbacks": [ModelTier.qwen3_32b],
        "queue": "batch",
        "prompt_bundle": "batch/v1",
    },
}

# Canary: fraction of premium_synthesis traffic routed to a candidate model
# version. Deterministic decision on decision_id hash (stable, no RNG drift).
CANARY = {
    "enabled": True,
    "workload_class": WorkloadClass.premium_synthesis.value,
    "candidate_model_version": "qwen3-235b-a22b@2024-12-canary",
    "stable_model_version": "qwen3-235b-a22b@2024-09",
    "traffic_fraction": 0.10,
}

AUDIT_CAPACITY = 500


class RoutingAuditLog:
    def __init__(self, capacity: int = AUDIT_CAPACITY):
        self._entries: deque[RoutingAuditEntry] = deque(maxlen=capacity)
        self._lock = threading.Lock()

    def append(self, entry: RoutingAuditEntry) -> None:
        with self._lock:
            self._entries.append(entry)
        log.info("routing decision", extra={
            "request_id": entry.request_id,
            "model_tier": entry.selected_tier.value,
            "workload_class": entry.workload_class.value,
        })

    def list(self, limit: int = 100) -> list[RoutingAuditEntry]:
        with self._lock:
            return list(self._entries)[-limit:]


audit_log = RoutingAuditLog()


def _canary_decision(decision_id: str, workload: WorkloadClass) -> str | None:
    if not CANARY["enabled"] or workload.value != CANARY["workload_class"]:
        return None
    bucket = int(uuid.uuid5(uuid.NAMESPACE_URL, decision_id).hex[:8], 16) % 100
    if bucket < CANARY["traffic_fraction"] * 100:
        return CANARY["candidate_model_version"]
    return CANARY["stable_model_version"]


class ModelRouter:
    """Routes generation requests to model tiers with fallback + audit."""

    def __init__(self, base_url: str | None = None, api_key: str | None = None,
                 timeout: float | None = None):
        self.base_url = (base_url if base_url is not None
                         else settings.vllm_base_url)
        self.api_key = api_key if api_key is not None else settings.vllm_api_key
        self.timeout = timeout if timeout is not None \
            else settings.llm_timeout_seconds

    @property
    def online(self) -> bool:
        return bool(self.base_url)

    # ------------------------------------------------------------------
    def route(self, workload_class: str) -> tuple[RoutingMetadata, list[ModelTier]]:
        workload = WorkloadClass(workload_class)
        policy = ROUTING_POLICY[workload]
        decision_id = f"route:{uuid.uuid4().hex[:12]}"
        chain: list[ModelTier] = [policy["primary"], *policy["fallbacks"]]
        canary_version = _canary_decision(decision_id, workload)
        meta = RoutingMetadata(
            workload_class=workload,
            selected_tier=policy["primary"],
            endpoint=self.base_url or "offline",
            queue=policy["queue"],
            canary_model_version=canary_version,
            prompt_bundle=policy["prompt_bundle"],
            decision_id=decision_id,
        )
        return meta, chain

    # ------------------------------------------------------------------
    def generate(self, workload_class: str, prompt: str,
                 request_id: str = "-") -> tuple[str | None, RoutingMetadata]:
        """Attempt completion via the fallback chain; returns (text|None, meta).

        None text signals callers to use the deterministic offline synthesizer
        (no endpoint configured, or all tiers failed)."""
        meta, chain = self.route(workload_class)
        started = time.monotonic()
        if not self.online:
            meta.offline = True
            meta.selected_tier = ModelTier.offline
            meta.attempts.append({"tier": "offline-synthesizer",
                                  "outcome": "no-endpoint-configured"})
            self._audit(meta, request_id, started)
            return None, meta

        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        model_version = meta.canary_model_version
        for tier in chain:
            body = {
                "model": model_version or tier.value,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.1,
                "max_tokens": 2048,
            }
            try:
                resp = httpx.post(f"{self.base_url}{TIER_ENDPOINTS[tier]}",
                                  json=body, headers=headers,
                                  timeout=self.timeout)
                resp.raise_for_status()
                text = resp.json()["choices"][0]["message"]["content"]
                meta.selected_tier = tier
                meta.attempts.append({"tier": tier.value, "outcome": "ok"})
                self._audit(meta, request_id, started)
                return text, meta
            except Exception as exc:  # timeout / 5xx / DNS — try next tier
                meta.attempts.append({"tier": tier.value,
                                      "outcome": f"failed:{type(exc).__name__}"})
                meta.fallback_used = True
        meta.offline = True
        meta.selected_tier = ModelTier.offline
        self._audit(meta, request_id, started)
        return None, meta

    # ------------------------------------------------------------------
    def _audit(self, meta: RoutingMetadata, request_id: str,
               started: float) -> None:
        audit_log.append(RoutingAuditEntry(
            decision_id=meta.decision_id,
            request_id=request_id,
            timestamp=datetime.now(timezone.utc),
            workload_class=meta.workload_class,
            selected_tier=meta.selected_tier,
            queue=meta.queue,
            attempts=meta.attempts,
            fallback_used=meta.fallback_used,
            offline=meta.offline,
            latency_ms=round((time.monotonic() - started) * 1000, 2),
        ))
