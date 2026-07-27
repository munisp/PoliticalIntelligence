# LLM Serving (services/ai)

Implements the serving half of `docs/MODEL_STRATEGY.md` (ADR-001..004). All
generative paths keep the deterministic offline synthesizer as the final
fallback — the platform remains fully functional without GPUs.

## Serving topology (`app/llm/serving.py`)

- **Per-tier endpoints.** Resolved from `VLLM_BASE_URL_{DEFAULT,PREMIUM,SPECIALIST}`,
  falling back to `VLLM_BASE_URL`. Tier mapping: DEFAULT → `qwen3-32b` /
  `qwen3-small`, PREMIUM → `qwen3-235b-a22b`, SPECIALIST → `deepseek-r1`.
  Unconfigured tier → its chain step is skipped, next fallback tried.
- **Connection pooling.** One lazily-created `httpx.Client` with keep-alive
  pool (32 conn / 16 keep-alive) shared across tiers.
- **Streaming.** `ServingClient.stream(tier, messages)` yields SSE content
  deltas (`stream=true`) for the interactive tier; breaker-aware.
- **Request hedging.** `LLM_HEDGE_AFTER_MS` (p95 estimate): when the primary
  request exceeds the hedge delay a duplicate is fired and the first result
  wins. Disabled at 0 (default).
- **Circuit breaker per tier.** Opens after `LLM_BREAKER_FAILURES`
  consecutive failures (default 3), stays open for
  `LLM_BREAKER_RESET_SECONDS` (default 30), then half-opens and closes on the
  first success. Open breaker → router walks the fallback chain → offline
  synthesizer. Breaker state is attached to every routing audit entry.
- **Metrics.** Per-tier request/failure counts and a latency ring (p95)
  exposed at `GET /v1/serving/metrics`; token usage (prompt/completion) is
  recorded on each attempt and on the routing audit entry.

## Prompt bundles (`app/llm/prompts/`)

Versioned prompt bundles as code, each with a changelog: `recommendation_v1`,
`copilot_grounded_v1`, `brief_memo_v1`, `legal_extract_v1`. A generation
result is always traceable to (model version, prompt bundle name, bundle
version) via the routing audit (`prompt_bundle` field).

**Shared output contract (§9.2).** The offline synthesizer and the LLM path
share the SAME recommendation contract. `app/llm/prompts/contract.py`
validates raw LLM output (required keys, `evidence_base ≥ 1` with citations,
`confidence ∈ [0,1]`, integer `estimated_jobs`) with one repair retry: on
contract failure the model is re-prompted once with the validation errors;
failure after that degrades to the offline synthesizer. JSON extraction
repairs markdown fences / surrounding prose and marks the result `repaired`.

## Embeddings (`app/llm/embeddings.py`)

Batch embedding job for the vector path:

- **Backend order:** sentence-transformers (optional extra, lazy import,
  `EMBEDDING_MODEL`, default `all-MiniLM-L6-v2`) → **deterministic hashing
  embedding** (documented default): md5(token) → (index, sign) in 384 dims,
  L2-normalized; reproducible, no downloads. Replaces the TF-IDF-only
  fallback for the k-NN path (TF-IDF retrieval itself remains).
- **Sink:** OpenSearch k-NN index (`OPENSEARCH_URL`,
  `OPENSEARCH_KNN_INDEX`, default `policy-embeddings`) when configured;
  otherwise a JSONL artifact (`EMBEDDINGS_OUT`, default
  `artifacts/embeddings.jsonl`).
- **Batch reindex:** `python -m app.llm.embeddings reindex [--backend NAME] [--out PATH]`.

## Compose (GPU profile)

`infra/docker/docker-compose.yml` ships a working-but-profiled `vllm`
service (`vllm/vllm-openai`, `Qwen/Qwen3-32B` default, NVIDIA GPU deploy
resources, `profiles: ["gpu"]`). Enable with
`docker compose --profile gpu up vllm` and set
`VLLM_BASE_URL=http://vllm:8000` on the `ai` service. Per-tier production
topologies (separate GPU pools per MODEL_STRATEGY.md) map to multiple such
services with `VLLM_BASE_URL_{DEFAULT,PREMIUM,SPECIALIST}`.
