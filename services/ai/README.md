# Hybrid Retrieval + LLM Routing (`services/ai`)

FastAPI microservice implementing spec **§20–21** (Retrieval: Vector + Graph +
SQL; LLM Orchestration & Model Strategy) for the Jurisdiction Economic
Intelligence & Policy Twin Platform. **Fully functional without GPUs**: when
no LLM endpoint is configured, a deterministic offline synthesizer produces
the complete Recommendation contract (spec §9.2).

## Quick start

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --port 8081
python -m pytest
```

Docker: `docker build -t ai-retrieval . && docker run -p 8081:8081 ai-retrieval`

## API

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness + adapter modes + llm mode (`offline-synthesizer` or `online`) |
| `POST` | `/v1/retrieve` | `{query, jurisdiction_id, filters, top_k}` → fused `EvidenceBundle` |
| `POST` | `/v1/recommendations` | Grounded structured Recommendation (spec §9.2) |
| `POST` | `/v1/copilot/query` | Answer + citations + uncertainty indicators (SR-8) |
| `GET` | `/v1/routing/audit?limit=100` | Routing decision audit log |

Standard envelope `{data, meta{request_id, correlation_id,
api_version:"v1"}, audit{actor_id, generated_at}}`; errors
`{error: {code, message, request_id, retryable, details}}`. Request context
headers: `X-Request-ID`, `X-Correlation-ID`, `X-Actor-ID`.

### Example

```bash
curl -X POST localhost:8081/v1/retrieve -H 'Content-Type: application/json' \
  -d '{"query": "teacher licensing education jobs", "jurisdiction_id": "jur:ng-kd", "top_k": 8}'

curl -X POST localhost:8081/v1/recommendations -H 'Content-Type: application/json' \
  -d '{"query": "create jobs through teacher hiring and school meals",
       "jurisdiction_id": "jur:ng-kd", "sector": "education",
       "workload_class": "premium_synthesis"}'

curl -X POST localhost:8081/v1/copilot/query -H 'Content-Type: application/json' \
  -d '{"query": "what does the public procurement act require?"}'
```

## Retrieval (`app/retrieval/`)

Three paths fused by **reciprocal-rank fusion** into ranked evidence bundles
with provenance (spec §39 canonical `EvidenceSource { evidence_source_id,
source_type, citation, retrieval_path, confidence, content }`):

| Adapter | Live backend (env) | Deterministic fallback |
|---|---|---|
| `sql_adapter.py` | Trino/Postgres protocol (`SQL_DSN`) | Seeded Nigeria pilot metrics + jurisdiction profiles |
| `vector_adapter.py` | OpenSearch (`OPENSEARCH_URL`) | TF-IDF cosine over seeded legal/policy passages (numpy — no embedding service) |
| `graph_adapter.py` | Neo4j (`NEO4J_URI`) | In-process graph: laws→clauses→agencies→sectors with `CITES/ENABLES/RESTRICTS/APPLIES_TO` edges |

## LLM routing (`app/llm/`) — spec §21

- **Tiers**: `qwen3-32b` (default production), `qwen3-235b-a22b` (premium
  strategic synthesis), `deepseek-r1` (specialist hard analysis),
  `qwen3-small` (dev/batch).
- **Policy routing** by workload class: `interactive_copilot`,
  `premium_synthesis`, `hard_analysis`, `batch`.
- **Queue separation**: interactive vs batch.
- **Fallback chain** on timeout/unavailability (e.g. deepseek-r1 →
  qwen3-235b → qwen3-32b → offline).
- **Canary config** by model version + prompt bundle (10% of premium traffic,
  deterministic on decision id).
- **Audit**: every routing decision is recorded (`GET /v1/routing/audit`) and
  emitted to structured logs.
- **Protocol**: OpenAI-compatible chat completions against vLLM / Ray Serve
  (`VLLM_BASE_URL`, `VLLM_API_KEY`).

### Offline synthesizer (`app/llm/offline.py`)

Deterministically assembles the spec §9.2 Recommendation contract —
`rationale, assumptions, evidence_base, estimated_jobs, budget_ranges,
timeline, implementation_actors, legal_dependencies, risk_register, kpis,
simulation_scenarios` — from the fused evidence bundle + sector playbook
templates. Every output carries `model_routing` metadata, evidence references
and a confidence score (explainability requirement). Same input ⇒ same
output.

## Configuration (env)

`HOST`, `PORT` (8081), `LOG_LEVEL`, `SQL_DSN`, `OPENSEARCH_URL`,
`OPENSEARCH_INDEX`, `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD`,
`VLLM_BASE_URL`, `VLLM_API_KEY`, `LLM_TIMEOUT_SECONDS`, `DEFAULT_SEED`.

## Seeded corpus (`app/data/corpus.py`)

Nigeria pilot legal/policy passages (UBE Act 2004, TRCN licensing, Public
Procurement Act 2007, SMEDAN Act, Electricity Act 2023, NHGSFP school-meal
programme, Kaduna state laws) with citations, plus metrics, jurisdiction
profiles and the dependency graph. `neo4j` / `opensearch-py` / `boto3` are
optional extras (`requirements-extras.txt`).
