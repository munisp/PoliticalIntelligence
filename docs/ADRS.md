# Architecture Decision Records

Format: Context / Decision / Rationale / Consequences / Alternatives considered.

---

## ADR-001: Qwen3 as the primary LLM family

**Context.** The platform must be sovereign-ready: no dependency on proprietary hosted model APIs, deployable in-country on government or national-cloud GPU capacity, with strong multilingual and long-document reasoning for policy texts, and an open license permitting public-sector use and fine-tuning.

**Decision.** Standardize on the Qwen3 open-weight model family as the primary LLM family across all product features (copilot, opportunity generation, legislation analysis, brief generation).

**Rationale.** Qwen3 offers a coherent size ladder (small dev tier → 32B → 235B-A22B MoE), strong multilingual and reasoning performance, permissive open weights, and first-class support in vLLM and Ray Serve. A single family simplifies routing, evaluation harnesses, and prompt regression testing.

**Consequences.** One prompt/eval stack to maintain; GPU capacity planning revolves around Qwen3 tiers (see `MODEL_STRATEGY.md`); full air-gap capability. We accept the operational burden of self-hosting.

**Alternatives.** Proprietary hosted APIs (rejected: sovereignty, data-residency, cost at national scale); Llama family (viable fallback; Qwen3 chosen for multilingual strength and MoE efficiency at the premium tier); Mistral/Mixtral (smaller ecosystem for our serving stack).

---

## ADR-002: DeepSeek-R1 as the specialist reasoning tier

**Context.** Some workloads — complex legislation comparison, multi-step policy causal chains, simulation result interpretation — benefit from long explicit reasoning traces that general chat models handle less reliably.

**Decision.** Add DeepSeek-R1 as a specialist reasoning tier, invoked by the model router only for tasks classified as deep-reasoning, with its reasoning trace captured for explainability review.

**Rationale.** DeepSeek-R1 provides best-in-class open-weight chain-of-thought reasoning; restricting it to a specialist tier keeps its latency/cost off the interactive path while preserving capability where it matters.

**Consequences.** The router gains a tier (`deepseek-r1`) with its own GPU pool and SLOs; traces must be stored with audit records; eval harness must include specialist-tier prompt regression.

**Alternatives.** Use Qwen3-235B for everything (rejected: weaker explicit reasoning traces, higher cost per deep-reasoning task); external reasoning APIs (rejected: sovereignty).

---

## ADR-003: vLLM for model serving

**Context.** Self-hosted LLMs need high-throughput, low-latency inference with continuous batching, quantization support, and OpenAI-compatible endpoints so application code stays provider-agnostic.

**Decision.** Serve all model tiers with vLLM.

**Rationale.** vLLM's PagedAttention and continuous batching deliver the best tokens/sec per GPU among open servers; OpenAI-compatible API lets the AI service treat every tier uniformly; strong support for Qwen3 and DeepSeek architectures.

**Consequences.** Standard serving images and config per tier; GPU memory sizing follows vLLM KV-cache guidance (see `MODEL_STRATEGY.md`); upgrades are image bumps with canary pools.

**Alternatives.** TGI (comparable; vLLM chosen for batching throughput and community velocity); Triton/TensorRT-LLM (higher ceiling but much higher operational complexity — revisit if GPU budget becomes binding).

---

## ADR-004: Ray Serve for model orchestration

**Context.** The platform runs multiple model tiers plus retrieval pipelines and background batch generation. We need request routing across tiers, autoscaling replica pools, and composition of LLM calls with retrieval and post-processing — beyond what a bare inference server provides.

**Decision.** Use Ray Serve as the orchestration layer in front of vLLM endpoints: the AI service calls Ray Serve deployments that own tier routing, retries, batch windows, and autoscaling policy.

**Rationale.** Ray Serve provides Python-native deployment composition, fractional-GPU and autoscaling support, and clean separation between interactive and batch pools — matching our dev/staging/prod topology without inventing a custom router.

**Consequences.** A Ray cluster is part of the serving topology per environment; model routing policy lives in code (reviewed, versioned); observability must cover Ray Serve deployment health per tier.

**Alternatives.** Direct vLLM + bespoke router in the AI service (simpler but re-implements autoscaling/routing); KServe (heavier CRD surface than needed at pilot scale).

---

## ADR-005: Apache Iceberg as the lakehouse table format

**Context.** Indicator history, ingest snapshots, and simulation outputs are large, append-heavy analytical datasets that need schema evolution, time travel (for simulation reproducibility and audit), and engine-independent storage on object storage.

**Decision.** Use Apache Iceberg on MinIO/S3 as the lakehouse table format for all analytical datasets.

**Rationale.** Iceberg gives ACID table semantics, hidden partitioning, schema evolution, and snapshot isolation — the dataset snapshot ids referenced by `SimulationRun` and `features.materialized` are Iceberg snapshots, making runs reproducible by construction.

**Consequences.** Every analytical dataset is an Iceberg table with a documented snapshot policy; retention/compaction jobs are part of platform ops; engines (Trino, Spark) read via the Iceberg catalog.

**Alternatives.** Delta Lake (comparable; Iceberg chosen for engine neutrality and Trino-first support); plain Parquet files (rejected: no ACID/time travel); warehouse-only approach (rejected: sovereignty and cost).

---

## ADR-006: Trino as the analytical query fabric

**Context.** Analysts and services need to query across the Iceberg lakehouse, MySQL operational data, and (via connectors) source systems — without ETL-ing everything into one engine.

**Decision.** Adopt Trino as the federated analytical query fabric; dbt models and analytical APIs query through Trino, never against operational stores directly for heavy reads.

**Rationale.** Trino's connector model (Iceberg, MySQL, PostgreSQL/PostGIS, Elasticsearch/OpenSearch) matches our store layout, isolates analytical load from operational MySQL, and gives data stewards one SQL surface for dbt data contracts.

**Consequences.** Trino cluster (even single-node in dev) is a standard environment component; analytical schemas are governed through dbt; operational APIs keep using Drizzle/MySQL for OLTP.

**Alternatives.** ClickHouse as the single analytics engine (strong, but federation into MySQL/PostGIS is weaker and storage duplicates the lakehouse); querying MySQL directly for analytics (rejected: operational risk).

---

## ADR-007: Hybrid vector + graph + SQL retrieval

**Context.** Evidence-grounded answers require retrieving the right context: semantically similar passages (vectors), relationship context such as amendment chains and agency linkages (graph), and exact indicator values and filters (SQL). Any single retrieval mode misses material evidence.

**Decision.** Standardize on hybrid retrieval in `services/ai`: OpenSearch k-NN + BM25 for text, Neo4j traversals for relationship context, and SQL (MySQL/Trino) for structured indicators — fused, re-ranked, and cited before any generation call.

**Rationale.** Hybrid retrieval measurably improves groundedness for policy questions; each store is already in the architecture for its primary role, so the marginal cost is the fusion/rerank layer; citations come naturally because every retrieved item carries source ids.

**Consequences.** Retrieval plans are explicit, logged, and evaluated (prompt regression + retrieval recall in `TESTING.md`); `graph.index.updated`/`features.materialized` events drive cache invalidation of retrieval plans.

**Alternatives.** Vector-only RAG (rejected: weak on exact figures and legal structure); SQL-only with LLM text-to-SQL (rejected: brittle for unstructured policy text); external managed retrieval service (rejected: sovereignty).
