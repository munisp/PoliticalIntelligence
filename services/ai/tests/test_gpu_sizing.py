"""AI-9: GPU sizing calculator — deterministic table assertions + patch gen."""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import yaml

SPEC = importlib.util.spec_from_file_location(
    "gpu_sizing",
    Path(__file__).resolve().parents[3] / "scripts" / "gpu-sizing.py",
)
import sys

gpu = importlib.util.module_from_spec(SPEC)
sys.modules["gpu_sizing"] = gpu  # dataclass introspection needs sys.modules
SPEC.loader.exec_module(gpu)


def test_pools_cover_spec_37_four_pools():
    assert set(gpu.POOLS) == {"interactive", "premium", "specialist", "batch"}
    assert gpu.POOLS["interactive"].capacity_type == "on-demand"
    assert gpu.POOLS["batch"].capacity_type == "spot"
    assert gpu.POOLS["premium"].gpus_per_replica == 2  # tensor-parallel 235B


def test_interactive_small_load_single_replica_plus_headroom():
    plan = gpu.size_pool("interactive", concurrency=5, latency_slo_s=60)
    # 5 streams fit in one replica (16 max + queue slots); +1 N+1 headroom
    assert plan.replicas == 2
    assert plan.total_gpus == 2
    assert plan.gpu_type == "L40S"
    assert plan.slo_met


def test_interactive_scale_out_deterministic():
    plan = gpu.size_pool("interactive", concurrency=64, latency_slo_s=60)
    # SLO 60s / ~37.3s single-stream => 1 affordable queue slot -> 17 streams/replica
    assert plan.replicas == 5  # ceil(64/17)=4 + 1 headroom
    assert plan.concurrency_supported >= 64
    assert plan.slo_met


def test_premium_uses_two_gpus_per_replica():
    plan = gpu.size_pool("premium", concurrency=4, latency_slo_s=120)
    assert plan.gpus_per_replica == 2
    assert plan.total_gpus == plan.replicas * 2


def test_batch_pool_no_headroom_spot():
    plan = gpu.size_pool("batch", concurrency=10, latency_slo_s=300)
    assert plan.capacity_type == "spot"
    assert plan.replicas == 1  # 10 streams << 64-stream replica, no N+1


def test_unreachable_slo_rejected():
    # single-stream on specialist is ~58.5s (2048/35); 30s SLO impossible
    with pytest.raises(ValueError, match="unreachable"):
        gpu.size_pool("specialist", concurrency=1, latency_slo_s=30)


def test_unknown_tier_and_bad_concurrency():
    with pytest.raises(KeyError):
        gpu.size_pool("quantum", 1, 10)
    with pytest.raises(ValueError):
        gpu.size_pool("interactive", 0, 10)


def test_overlay_patch_yaml_valid_and_pins_pool(tmp_path: Path):
    plan = gpu.size_pool("interactive", concurrency=32, latency_slo_s=60)
    patch = tmp_path / "patch.yaml"
    rc = gpu.main([
        "--tier", "interactive", "--concurrency", "32",
        "--latency-slo", "60", "--write-patch", str(patch), "--json",
    ])
    assert rc == 0
    docs = yaml.safe_load(patch.read_text())
    assert docs["kind"] == "RayService"
    wgs = docs["spec"]["rayClusterConfig"]["workerGroupSpecs"][0]
    assert wgs["replicas"] == plan.replicas
    sel = wgs["template"]["spec"]["nodeSelector"]
    assert sel == {"role": "gpu-inference", "gpu-pool": "interactive"}
    tol = wgs["template"]["spec"]["tolerations"][0]
    assert tol["value"] == "gpu-inference" and tol["effect"] == "NoSchedule"


def test_gpu_k8s_manifests_valid_and_tainted():
    base = Path(__file__).resolve().parents[3] / "infra" / "k8s" / "base"
    docs = list(yaml.safe_load_all((base / "gpu-nodepool.yaml").read_text()))
    kinds = {d["kind"] for d in docs}
    assert {"DaemonSet", "ResourceQuota"} <= kinds
    ds = next(d for d in docs if d["kind"] == "DaemonSet")
    spec = ds["spec"]["template"]["spec"]
    assert spec["nodeSelector"] == {"role": "gpu-inference"}
    assert any(t["value"] == "gpu-inference" and t["effect"] == "NoSchedule"
               for t in spec["tolerations"])
    kar = list(yaml.safe_load_all((base / "gpu-karpenter.yaml").read_text()))
    pools = {d["metadata"]["name"] for d in kar if d["kind"] == "NodePool"}
    assert pools == {"gpu-interactive", "gpu-batch"}
    ray = list(yaml.safe_load_all((base / "rayserve.yaml").read_text()))
    assert {d["kind"] for d in ray} >= {"RayCluster", "RayService", "Service"}
    rs = next(d for d in ray if d["kind"] == "RayService")
    wgs = rs["spec"]["rayClusterConfig"]["workerGroupSpecs"][0]
    wspec = wgs["template"]["spec"]
    assert wspec["nodeSelector"]["role"] == "gpu-inference"
    res = wspec["containers"][0]["resources"]["limits"]
    assert res["nvidia.com/gpu"] == "1"


def test_cli_exit_code_reflects_slo(capsys):
    rc = gpu.main(["--tier", "interactive", "--concurrency", "10",
                   "--latency-slo", "60"])
    assert rc == 0
    out = capsys.readouterr().out
    assert "pool=interactive" in out and "MET" in out
