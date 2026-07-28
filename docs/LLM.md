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

## Passage indexer + OpenSearch k-NN, end-to-end (AI-1/AI-2/AI-4/AI-12)

`app/retrieval/indexer.py` is the DEFAULT embedding indexer — no GPU, no
downloads required:

1. **Collect** passages from the retrieval corpus (laws/clauses/policy
   briefs/evidence) plus optional platform exports listed in
   `INDEXER_EXTRA_JSONL` (comma-separated JSONL files, one
   `{"id","type","jurisdiction","title","citation","content"}` per line —
   e.g. a nightly export of `laws`, `clauses`, `documents`, `briefs`,
   `evidence_sources`; dedup by id, corpus wins).
2. **Embed** in batches (`--batch-size`, default 64) with the deterministic
   hashing embedding (or sentence-transformers when installed).
3. **Persist** vectors to a JSONL artifact (`INDEXER_OUT`, default
   `artifacts/passage-vectors.jsonl`) AND, when `OPENSEARCH_URL` is set,
   bulk-index them into the k-NN index (`OPENSEARCH_KNN_INDEX`, default
   `policy-embeddings`, mapping: `knn_vector` dim 384 + keyword
   jurisdiction/type filters) via the plain `_bulk` HTTP API.

Run it:

```bash
cd services/ai
python -m app.retrieval.indexer reindex [--backend auto|hashing|sentence-transformers] [--out PATH]
python -m app.retrieval.indexer schedule --interval 86400   # blocking loop
INDEXER_INTERVAL_SECONDS=86400 uvicorn app.main:app          # in-service hook
```

**Query path:** with `OPENSEARCH_URL` set, `VectorAdapter` issues a native
k-NN query (`knn.embedding.vector` = hashing-embedded query text, `k`,
jurisdiction filter) against the indexer index; on any failure it falls
back to BM25, then to the in-process TF-IDF index. The gateway
(`api/search.ts`) delegates `/v1/search`-class queries to the AI service
`/v1/retrieve` and marks `retrieval_mode: "hybrid" | "fallback"` in the
response meta.

## Pointing at a real vLLM endpoint (AI-5)

The serving layer (`app/llm/serving.py`) speaks the OpenAI chat-completions
protocol; any vLLM server works. Env:

| Env | Meaning | Example |
| --- | --- | --- |
| `VLLM_BASE_URL` | default endpoint for all tiers | `http://vllm:8000` |
| `VLLM_BASE_URL_DEFAULT` | interactive/batch tier (qwen3-32b, qwen3-small) | `http://vllm-small:8000` |
| `VLLM_BASE_URL_PREMIUM` | synthesis tier (qwen3-235b) | `http://vllm-large:8000` |
| `VLLM_BASE_URL_SPECIALIST` | analysis tier (deepseek-r1) | `http://vllm-r1:8000` |
| `VLLM_API_KEY` | optional bearer token | — |
| `LLM_TIMEOUT_SECONDS` | per-request timeout (default 30) | `30` |
| `LLM_HEDGE_AFTER_MS` | fire a duplicate request after N ms (0 = off) | `800` |
| `LLM_BREAKER_FAILURES` | consecutive failures before the tier breaker opens (default 3) | `3` |
| `LLM_BREAKER_RESET_SECONDS` | open → half-open cooldown (default 30) | `30` |

Smoke test against a live server:

```bash
curl -s $VLLM_BASE_URL/v1/chat/completions -H 'Content-Type: application/json' -d '{
  "model": "qwen3-32b",
  "messages": [{"role": "user", "content": "Say OK"}],
  "max_tokens": 8
}'
# streaming
curl -N $VLLM_BASE_URL/v1/chat/completions -H 'Content-Type: application/json' -d '{
  "model": "qwen3-32b", "stream": true,
  "messages": [{"role": "user", "content": "Count to three"}]
}'
# then verify the platform picked it up:
curl -s localhost:8081/health | jq .llm_mode            # "online"
curl -s localhost:8081/v1/serving/metrics | jq .data    # per-tier requests/p95/breakers
```

The mock-endpoint integration suite (`tests/test_serving_live.py`) exercises
this exact path without a GPU: tier routing, breaker-on-5xx-storm → fallback
chain → offline synthesizer, SSE streaming, and §9.2 contract validation of
served JSON.

## Ray Serve transport (AI-7, ADR-004)

The serving layer supports two transports selected by `LLM_TRANSPORT`:

- `vllm` (default): direct vLLM OpenAI servers (`VLLM_BASE_URL[_TIER]`).
- `ray`: Ray Serve deployments on KubeRay (`RAY_SERVE_URL[_TIER]`), same
  OpenAI chat-completions schema mounted at route prefix `/v1/llm`
  (`app/llm/ray_serve.py`). Per-tier autoscaling/actor config (replicas,
  GPUs per replica, queue separation: interactive/premium/specialist) lives
  in `TIER_DEPLOYMENTS`. Client interface, circuit breakers and router
  fallback are identical across transports (tested in
  `services/ai/tests/test_ray_transport.py` against a mock endpoint).

Kubernetes manifests: `infra/k8s/base/rayserve.yaml` (RayCluster +
RayService + Service; GPU workers pinned to the AI-9 node pool via
`nodeSelector role=gpu-inference` + toleration). Requires the KubeRay
operator; add `rayserve.yaml` to `base/kustomization.yaml` resources on
GPU-enabled clusters (kept out of the dev overlay).