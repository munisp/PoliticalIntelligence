# Model Strategy (Qwen3-first)

This memo defines the model tiers, routing policy, serving topology, GPU sizing, and operational controls for all generative AI workloads on the platform. Decisions here implement ADR-001..004.

## Model tiers

| Tier        | Model               | Role                                                                                  | Latency target | Relative cost |
| ----------- | ------------------- | ------------------------------------------------------------------------------------- | -------------- | ------------- |
| Default     | **Qwen3-32B**       | Production default: copilot chat, opportunity narratives, brief drafts, summaries     | interactive (p95 first-token < 3s) | baseline |
| Premium     | **Qwen3-235B-A22B** | High-stakes analysis: executive briefs, complex multi-source synthesis, flagship demos | near-interactive | ~4–6× default |
| Dev         | **Qwen3 small tier**| Dev/CI, prompt iteration, synthetic-data environments; may run CPU/single small GPU    | best-effort | minimal |
| Specialist  | **DeepSeek-R1**     | Deep reasoning: legislation comparison, causal chains, simulation interpretation; reasoning trace stored for review | async-tolerant | ~2–3× default per request |

## Routing strategy

Routing is policy-as-code inside `services/ai` behind the Ray Serve layer:

1. **Task classification.** Each request is classified (copilot chat / opportunity generation / brief generation / legislation analysis / simulation interpretation / embedding-only).
2. **Default path.** Everything starts at the **default tier (Qwen3-32B)**.
3. **Escalation.** Requests escalate to the **premium tier** only when (a) the caller's role is executive and the product surface is brief generation or flagship analysis, or (b) a quality gate (retrieval coverage below threshold, self-consistency check failure) fires on the default tier.
4. **Specialist path.** Deep-reasoning tasks (legislation comparison, causal interpretation) route to **DeepSeek-R1**, always asynchronously, with the reasoning trace persisted alongside the audit record.
5. **Dev path.** Dev/staging-synthetic environments pin `MODEL_DEFAULT_TIER=qwen3-dev`.
6. **Fallbacks.** If a tier is unavailable, the router degrades premium→default and specialist→default-with-disclaimer, and emits a `ModelTierUnavailable` signal (see `infra/monitoring/alerts.yml`). Every routing decision (task class, tier, fallback, token counts) is logged as a `model routing record` and attached to `recommendations.generated`.

## Serving topology per environment

| Environment | Topology                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| Dev         | Single GPU (or CPU stub): one vLLM instance with the dev tier; Ray Serve local or in-cluster single node. Docker compose stack uses in-process stubs by default. |
| Staging     | One GPU pool: vLLM serving Qwen3-32B behind Ray Serve; premium/specialist tiers emulated by routing to default with tier tags for cost/quality telemetry. |
| Prod        | Separate GPU pools per tier (interactive / premium / specialist / batch), each vLLM + Ray Serve deployment with independent autoscaling; isolated event brokers for AI workloads. |

## GPU sizing guidance (pools)

Sizing assumes vLLM with FP16/BF16 weights and typical policy-context lengths (8–32k tokens). Validate against measured KV-cache pressure before procurement.

| Pool         | Serves                          | Reference sizing                                                                 |
| ------------ | ------------------------------- | -------------------------------------------------------------------------------- |
| Interactive  | Qwen3-32B (default tier)        | 1–2 × 80GB GPUs (or 4 × 48GB) per replica; 2 replicas for HA; ~20 concurrent LLM sessions (NFR) |
| Premium      | Qwen3-235B-A22B (MoE)           | 4–8 × 80GB GPUs per replica (tensor parallel); 1 replica min, scale on brief-generation backlog |
| Specialist   | DeepSeek-R1                     | 4 × 80GB per replica; async workloads only, autoscaled to zero off-hours          |
| Batch        | Nightly embeddings, re-index, bulk brief generation | Spot/preemptible capacity; shares image/config with interactive pool |

Kubernetes: GPU nodes are tainted (`workload=gpu:NoSchedule`, see `infra/terraform`); pools map to node groups with pod node-selectors.

## Operational controls

- **Eval gates.** Prompt regression + task evals run in CI/CD before any model image, prompt, or routing-policy change ships (see `TESTING.md`).
- **Cost telemetry.** Per-tier token counts, latency, and cost attribution exported as metrics (`model_requests_total{tier=...}`) — visible on the Platform Overview dashboard.
- **Prompt & policy versioning.** Prompts and routing policy are versioned artifacts; a generation result can always be traced to (model version, prompt version, retrieval plan, dataset snapshot).
- **Safety & privacy.** No prompts or documents leave the deployment; PII redaction precedes generation for non-public documents (see `SECURITY.md`); DeepSeek-R1 traces are reviewable by data stewards.
- **Capacity alarms.** Queue depth on generation topics, tier error rate, and KV-cache/GPU utilization alert before user-visible degradation.
