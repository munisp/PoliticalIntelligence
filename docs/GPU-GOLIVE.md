# GPU LLM Tier Go-Live Runbook (G1)

This runbook turns the remote LLM serving tier on for the first time. Go-live
is an **eval-gated switch flip**: the platform is fully functional without
GPUs (deterministic offline synthesizer), so nothing below is irreversible —
unsetting one env var restores the previous behavior.

**Components**
- Manifests: `infra/k8s/model-serving/` (vLLM Qwen3-8B deployment, Service +
  HPA, Ray Serve config) — wired into `infra/k8s/overlays/staging` and
  `overlays/prod`. Dev intentionally excludes them.
- Eval gate: `services/ai/app/evals/` — fixed 17-case pack (Q&A faithfulness
  over a retrieval bundle, citation presence, refusal behavior, JSON-schema
  conformance).
- Switch: `LLM_REMOTE_BASE_URL` (alias for `VLLM_BASE_URL`) on the `ai`
  deployment. Fallback chain + circuit breakers in `app/llm/router.py` /
  `app/llm/serving.py` degrade to the offline synthesizer automatically.

> **Cost warning.** Each vLLM replica requests **1 GPU** (the HPA can scale to
> 4; the namespace ResourceQuota caps at 8). A single g5.2xlarge-class GPU node
> costs roughly **$1.2–$1.5/hour on-demand (~$900–$1,100/month) per replica**;
> premium tiers cost substantially more. Do not apply in prod without a
> budget sign-off, and prefer autoscaling-to-minimum outside business hours.

## Step 0 — Preconditions

- Cluster with the KubeRay operator only if using the Ray transport
  (`LLM_TRANSPORT=ray`); the plain vLLM path needs no operator.
- `HF_TOKEN` present in `platform-secrets` if the model requires a
  Hugging Face token.
- The eval harness runs anywhere Python + the service deps are installed
  (`pip install -r services/ai/requirements.txt`).

## Step 1 — Apply the Terraform GPU node pool

```bash
cd infra/terraform
terraform plan -var="enable_gpu_node_group=true"   # review cost impact first
terraform apply -var="enable_gpu_node_group=true"
```

This creates `aws_eks_node_group.gpu` with labels `role=gpu-inference` /
`gpu-pool=<pool>` and taint `role=gpu-inference:NoSchedule`
(see `infra/k8s/base/gpu-nodepool.yaml` for the pool contract). Verify:

```bash
kubectl get nodes -l role=gpu-inference
kubectl get ds nvidia-device-plugin -n kube-system   # nvidia.com/gpu advertised
```

## Step 2 — Apply the model-serving manifests

```bash
kubectl apply -k infra/k8s/overlays/staging    # includes ../../model-serving
kubectl -n policy-twin rollout status deploy/vllm-qwen3-8b --timeout=20m
kubectl -n policy-twin port-forward svc/vllm-qwen3-8b 8000:8000
```

Readiness takes several minutes (model download + CUDA graph capture).

## Step 3 — Run the eval gate (do NOT skip)

```bash
cd services/ai
python -m app.evals.run --endpoint http://localhost:8000 --gate 0.8 --model qwen3-8b
```

Exit code must be `0` (suite score ≥ 80% across faithfulness, citation,
refusal, and JSON-schema categories). **If the gate fails, stop here** —
capture the per-case output, keep the tier remote-dark, and investigate the
model/prompt bundles before retrying.

## Step 4 — Flip the switch

Set the serving base URL on the `ai` deployment (staging first):

```bash
kubectl -n policy-twin set env deploy/ai \
  LLM_REMOTE_BASE_URL=http://vllm-qwen3-8b:8000
# or, for the Ray transport:
#   LLM_TRANSPORT=ray RAY_SERVE_URL=http://policy-twin-ray-serve:8000
kubectl -n policy-twin rollout status deploy/ai
```

`VLLM_BASE_URL` takes precedence if both are set. Optional tuning:
`VLLM_BASE_URL_{DEFAULT,PREMIUM,SPECIALIST}`, `LLM_TIMEOUT_SECONDS`,
`LLM_BREAKER_FAILURES`, `LLM_BREAKER_RESET_SECONDS`, `LLM_HEDGE_AFTER_MS`.

## Step 5 — Verify remote traffic

Watch the routing metric move from offline to remote:

```bash
kubectl -n policy-twin port-forward svc/ai 8200:8000 &
curl -s localhost:8200/metrics | grep llm_routing_decisions_total
# expect llm_routing_decisions_total{tier="qwen3-32b",offline="false"} increasing
curl -s localhost:8200/v1/serving/metrics     # per-tier requests, p95, breakers
```

Then drive real traffic (copilot query / brief generation) and confirm
`tier="remote"` routing records in the audit store. Suggested soak: 24h in
staging before repeating Steps 2–5 against `overlays/prod`.

## Rollback

```bash
kubectl -n policy-twin set env deploy/ai LLM_REMOTE_BASE_URL-
```

(Unsets the variable; the router immediately returns to the offline
synthesizer.) No manifest changes are required — the vLLM deployment can
stay warm for a re-attempt or be scaled to zero:

```bash
kubectl -n policy-twin scale deploy/vllm-qwen3-8b --replicas=0
```

Note: even without rollback, an unhealthy remote tier self-mitigates — the
circuit breaker opens after `LLM_BREAKER_FAILURES` consecutive failures and
the router degrades to the offline synthesizer until it half-closes.

## Code-only scope

This change ships manifests, the eval harness, and this runbook only. No
`terraform apply`, no `kubectl apply`, and no cloud calls are performed as
part of G1.
