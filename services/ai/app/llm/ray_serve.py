"""AI-7 (ADR-004): Ray Serve deployment module for the LLM tiers.

ray[serve] is an OPTIONAL extra — this module is import-guarded so the ai
service and its tests never require ray. When deployed (KubeRay in k8s,
see infra/k8s/base/rayserve.yaml), it exposes an OpenAI-compatible endpoint
at route prefix /v1/llm that the serving layer reaches via the `ray`
transport (LLM_TRANSPORT=ray, see serving.py ServingConfig.from_env).

Layout per model tier (spec §21/§37):
  interactive (DEFAULT: qwen3-32b / qwen3-small) — latency-sensitive,
    autoscaling on ongoing requests, 1 GPU per replica
  premium (qwen3-235b) — 2 GPUs per replica (tensor-parallel), low min
  specialist (deepseek-r1) — 1 GPU per replica, queue-separated
  (batch traffic stays on the vLLM batch pool — AI-9 gpu-sizing)

Each deployment wraps a vLLM AsyncLLMEngine inside the Ray replica; the
FastAPI ingress adapts the OpenAI chat-completions schema.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any

from app.logging_setup import get_logger

log = get_logger("llm.ray_serve")

ROUTE_PREFIX = "/v1/llm"


def ray_available() -> bool:
    try:
        import ray  # noqa: F401
        from ray import serve  # noqa: F401

        return True
    except ImportError:
        return False


# ---------------------------------------------------------------------------
# Tier -> autoscaling/actor config (pure data — unit-testable without ray)
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class TierDeploymentConfig:
    env_tier: str
    model: str
    route: str
    num_gpus_per_replica: float
    min_replicas: int
    max_replicas: int
    max_ongoing_requests: int
    target_ongoing_requests: int
    queue_separation: str  # ray serve _request_router / queue label

    def autoscaling_config(self) -> dict[str, Any]:
        return {
            "min_replicas": self.min_replicas,
            "max_replicas": self.max_replicas,
            "target_ongoing_requests": self.target_ongoing_requests,
            "metrics_interval_s": 10,
            "look_back_period_s": 30,
            "downscale_delay_s": 300,
            "upscale_delay_s": 30,
        }

    def ray_actor_options(self) -> dict[str, Any]:
        return {
            "num_gpus": self.num_gpus_per_replica,
            "num_cpus": max(2, int(self.num_gpus_per_replica * 8)),
            "resources": {f"queue:{self.queue_separation}": 0.01},
        }


TIER_DEPLOYMENTS: dict[str, TierDeploymentConfig] = {
    "DEFAULT": TierDeploymentConfig(
        env_tier="DEFAULT",
        model=os.getenv("RAY_MODEL_DEFAULT", "Qwen/Qwen3-32B"),
        route=f"{ROUTE_PREFIX}/chat/completions",
        num_gpus_per_replica=1,
        min_replicas=1,
        max_replicas=int(os.getenv("RAY_MAX_REPLICAS_DEFAULT", "4")),
        max_ongoing_requests=32,
        target_ongoing_requests=8,
        queue_separation="interactive",
    ),
    "PREMIUM": TierDeploymentConfig(
        env_tier="PREMIUM",
        model=os.getenv("RAY_MODEL_PREMIUM", "Qwen/Qwen3-235B-A22B"),
        route=f"{ROUTE_PREFIX}/chat/completions",
        num_gpus_per_replica=2,
        min_replicas=0,
        max_replicas=int(os.getenv("RAY_MAX_REPLICAS_PREMIUM", "2")),
        max_ongoing_requests=16,
        target_ongoing_requests=4,
        queue_separation="premium",
    ),
    "SPECIALIST": TierDeploymentConfig(
        env_tier="SPECIALIST",
        model=os.getenv("RAY_MODEL_SPECIALIST", "deepseek-ai/DeepSeek-R1"),
        route=f"{ROUTE_PREFIX}/chat/completions",
        num_gpus_per_replica=1,
        min_replicas=0,
        max_replicas=int(os.getenv("RAY_MAX_REPLICAS_SPECIALIST", "2")),
        max_ongoing_requests=8,
        target_ongoing_requests=2,
        queue_separation="specialist",
    ),
}


# ---------------------------------------------------------------------------
# Deployment construction (lazy ray import)
# ---------------------------------------------------------------------------
def build_deployments() -> dict[str, Any]:
    """Construct the Ray Serve deployments for every tier.

    Requires ray[serve] + vllm in the Ray runtime env (k8s RayService
    runtimeEnv, see infra/k8s/base/rayserve.yaml)."""
    try:
        import ray  # noqa: F401
        from ray import serve
    except ImportError as exc:
        raise RuntimeError(
            "ray[serve] is not installed — pip install -r "
            "requirements-extras.txt (extra: ray[serve])"
        ) from exc

    deployments: dict[str, Any] = {}
    for env_tier, cfg in TIER_DEPLOYMENTS.items():
        deployments[env_tier] = _make_deployment(serve, cfg)
    return deployments


def _make_deployment(serve: Any, cfg: TierDeploymentConfig):
    """One Ray Serve deployment wrapping a vLLM engine for a tier."""

    @serve.deployment(
        name=f"llm-{cfg.env_tier.lower()}",
        autoscaling_config=cfg.autoscaling_config(),
        ray_actor_options=cfg.ray_actor_options(),
        max_ongoing_requests=cfg.max_ongoing_requests,
    )
    @serve.ingress  # FastAPI ingress mounted at ROUTE_PREFIX by the app
    class LLMDeployment:
        def __init__(self) -> None:
            from fastapi import FastAPI
            from vllm.engine.arg_utils import AsyncEngineArgs
            from vllm.engine.async_llm_engine import AsyncLLMEngine

            self.app = FastAPI()
            engine_args = AsyncEngineArgs(
                model=cfg.model,
                tensor_parallel_size=max(1, int(cfg.num_gpus_per_replica)),
                gpu_memory_utilization=float(
                    os.getenv("VLLM_GPU_MEM_UTIL", "0.90")
                ),
                max_model_len=int(os.getenv("VLLM_MAX_MODEL_LEN", "8192")),
            )
            self.engine = AsyncLLMEngine.from_engine_args(engine_args)
            self.model = cfg.model

            @self.app.post("/chat/completions")
            async def chat_completions(body: dict) -> dict:
                # OpenAI-compatible: delegated to vLLM's serving layer.
                from vllm.entrypoints.openai.protocol import (
                    ChatCompletionRequest,
                )
                from vllm.entrypoints.openai.serving_chat import (
                    OpenAIServingChat,
                )

                request = ChatCompletionRequest(
                    model=self.model,
                    messages=body["messages"],
                    temperature=body.get("temperature", 0.1),
                    max_tokens=body.get("max_tokens", 2048),
                    stream=body.get("stream", False),
                )
                serving = OpenAIServingChat(
                    self.engine, model_config=None,  # type: ignore[arg-type]
                    served_model_names=[self.model],
                )
                resp = await serving.create_chat_completion(request, None)  # type: ignore[arg-type]
                if hasattr(resp, "model_dump"):
                    return resp.model_dump()
                return resp

    return LLMDeployment


def serve_app() -> Any:
    """Bind all tier deployments at ROUTE_PREFIX and return the Serve app.
    Entrypoint referenced by infra/k8s/base/rayserve.yaml
    (serveConfigV2 import path)."""
    from ray import serve

    deployments = build_deployments()
    # All tiers share the route prefix; queue separation is via actor
    # resources + per-tier deployment names (the gateway picks the tier by
    # model name in the request body — see serving.py TIER_ENV).
    return {tier: d.bind() for tier, d in deployments.items()}
