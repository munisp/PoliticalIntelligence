#!/usr/bin/env python3
"""AI-9 (spec §37): GPU pool sizing calculator.

Inputs:  model tier, concurrency target (concurrent interactive sessions),
         latency SLO (p95 seconds for a full response).
Output:  recommended GPU type + replica count per §37 pool, printed plan,
         and optionally a k8s overlay patch (Kustomize strategic-merge YAML)
         scaling the corresponding pool's workload.

The sizing table encodes spec §37 pool definitions with measured/estimated
throughput per replica (tokens/s) and per-request latency at a reference
concurrency, assuming vLLM continuous batching, 2k-token responses:

  interactive  Qwen3-32B       L40S 48GB (g6.12xlarge-class)  ~55 tok/s/stream
  premium      Qwen3-235B-A22B 2x A100 80GB (p4d-class)       ~40 tok/s/stream
  specialist   DeepSeek-R1     A100 80GB (p4de-class)         ~35 tok/s/stream
  batch        embed/rerank    L4 24GB (g6-class, spot)       ~600 tok/s/agg

Deterministic: the same inputs always produce the same plan (tests pin the
table).

Usage:
  python3 scripts/gpu-sizing.py --tier interactive --concurrency 50 --latency-slo 5
  python3 scripts/gpu-sizing.py --tier premium --concurrency 8 --latency-slo 20 --write-patch out.yaml
"""
from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass, asdict

TOKENS_PER_RESPONSE = 2048  # planning assumption (brief/answer length)


@dataclass(frozen=True)
class GpuPool:
    name: str
    model: str
    gpu_type: str
    gpus_per_replica: int
    tok_s_per_stream: float   # decode rate one stream sees at reference load
    max_streams_per_replica: int  # vLLM continuous-batching sweet spot
    capacity_type: str        # on-demand | spot
    k8s_label: str            # gpu-pool label value


# spec §37 pools
POOLS: dict[str, GpuPool] = {
    "interactive": GpuPool(
        name="interactive", model="Qwen3-32B", gpu_type="L40S",
        gpus_per_replica=1, tok_s_per_stream=55.0,
        max_streams_per_replica=16, capacity_type="on-demand",
        k8s_label="interactive",
    ),
    "premium": GpuPool(
        name="premium", model="Qwen3-235B-A22B", gpu_type="A100-80GB",
        gpus_per_replica=2, tok_s_per_stream=40.0,
        max_streams_per_replica=8, capacity_type="on-demand",
        k8s_label="premium",
    ),
    "specialist": GpuPool(
        name="specialist", model="DeepSeek-R1", gpu_type="A100-80GB",
        gpus_per_replica=1, tok_s_per_stream=35.0,
        max_streams_per_replica=4, capacity_type="on-demand",
        k8s_label="specialist",
    ),
    "batch": GpuPool(
        name="batch", model="embeddings/reranker", gpu_type="L4",
        gpus_per_replica=1, tok_s_per_stream=600.0,
        max_streams_per_replica=64, capacity_type="spot",
        k8s_label="batch",
    ),
}


@dataclass(frozen=True)
class Plan:
    pool: str
    model: str
    gpu_type: str
    gpus_per_replica: int
    replicas: int
    total_gpus: int
    capacity_type: str
    concurrency_supported: int
    latency_p95_est_s: float
    slo_met: bool


def size_pool(tier: str, concurrency: int, latency_slo_s: float) -> Plan:
    """Deterministic sizing: replicas = max(latency-driven, concurrency-
    driven), +1 headroom replica for interactive/premium tiers."""
    if tier not in POOLS:
        raise KeyError(f"unknown tier {tier!r} — expected {sorted(POOLS)}")
    if concurrency < 1:
        raise ValueError("concurrency must be >= 1")
    pool = POOLS[tier]

    # latency-driven: streams a replica can hold while keeping p95 <= SLO.
    # Single-stream latency for a 2k-token response; streams beyond
    # max_streams queue, adding ~one response time per queue slot.
    single_stream_s = TOKENS_PER_RESPONSE / pool.tok_s_per_stream
    if single_stream_s > latency_slo_s:
        raise ValueError(
            f"SLO {latency_slo_s}s unreachable on {pool.name}: single-stream "
            f"latency is ~{single_stream_s:.1f}s for {TOKENS_PER_RESPONSE} tokens"
        )
    queue_slots_affordable = max(0, int(latency_slo_s / single_stream_s) - 1)
    effective_streams = pool.max_streams_per_replica + queue_slots_affordable

    replicas = math.ceil(concurrency / effective_streams)
    if tier in ("interactive", "premium"):
        replicas += 1  # N+1 headroom for node drains/rollouts
    replicas = max(replicas, 1 if tier == "interactive" else 0) or 1

    latency_est = single_stream_s * (
        1 + max(0, math.ceil(concurrency / replicas) - pool.max_streams_per_replica)
        / max(1, pool.max_streams_per_replica)
    )
    return Plan(
        pool=pool.name,
        model=pool.model,
        gpu_type=pool.gpu_type,
        gpus_per_replica=pool.gpus_per_replica,
        replicas=replicas,
        total_gpus=replicas * pool.gpus_per_replica,
        capacity_type=pool.capacity_type,
        concurrency_supported=replicas * effective_streams,
        latency_p95_est_s=round(latency_est, 1),
        slo_met=latency_est <= latency_slo_s,
    )


def overlay_patch(plan: Plan, deployment: str = "policy-twin-ray-serve") -> str:
    """Kustomize strategic-merge patch scaling the pool's GPU workers."""
    return f"""# AI-9 gpu-sizing plan — generated patch (pool={plan.pool})
apiVersion: ray.io/v1
kind: RayService
metadata:
  name: {deployment}
  namespace: policy-twin
spec:
  rayClusterConfig:
    workerGroupSpecs:
      - groupName: gpu-{plan.pool}
        replicas: {plan.replicas}
        minReplicas: {1 if plan.pool == 'interactive' else 0}
        maxReplicas: {plan.replicas * 2}
        template:
          spec:
            nodeSelector:
              role: gpu-inference
              gpu-pool: {plan.pool}
            tolerations:
              - key: role
                operator: Equal
                value: gpu-inference
                effect: NoSchedule
"""


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="AI-9 GPU pool sizing (spec §37)")
    ap.add_argument("--tier", required=True, choices=sorted(POOLS))
    ap.add_argument("--concurrency", type=int, required=True,
                    help="target concurrent sessions")
    ap.add_argument("--latency-slo", type=float, required=True,
                    help="p95 end-to-end SLO in seconds")
    ap.add_argument("--write-patch", help="write a k8s overlay patch YAML here")
    ap.add_argument("--json", action="store_true", help="print plan as JSON")
    args = ap.parse_args(argv)

    plan = size_pool(args.tier, args.concurrency, args.latency_slo)
    if args.json:
        print(json.dumps(asdict(plan), indent=2))
    else:
        print(f"pool={plan.pool} model={plan.model}")
        print(f"gpu={plan.gpu_type} x{plan.gpus_per_replica}/replica "
              f"({plan.capacity_type})")
        print(f"replicas={plan.replicas} total_gpus={plan.total_gpus}")
        print(f"concurrency_supported={plan.concurrency_supported} "
              f"(target {args.concurrency})")
        print(f"latency_p95_est={plan.latency_p95_est_s}s "
              f"slo={args.latency_slo}s -> {'MET' if plan.slo_met else 'MISSED'}")
    if args.write_patch:
        with open(args.write_patch, "w") as fh:
            fh.write(overlay_patch(plan))
        print(f"patch written to {args.write_patch}")
    return 0 if plan.slo_met else 1


if __name__ == "__main__":
    raise SystemExit(main())
