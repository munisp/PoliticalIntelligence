"""Environment-driven configuration with sane defaults."""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    service_name: str = "ai-retrieval-llm"
    api_version: str = "v1"
    host: str = "0.0.0.0"
    port: int = 8081
    log_level: str = "INFO"

    # SQL adapter (Trino/Postgres protocol). Empty -> seeded fallback.
    sql_dsn: str | None = None
    # Vector adapter (OpenSearch). Empty -> TF-IDF fallback over seeded corpus.
    opensearch_url: str | None = None
    opensearch_index: str = "policy-passages"
    # Graph adapter (Neo4j). Empty -> in-process graph fallback.
    neo4j_uri: str | None = None
    neo4j_user: str = "neo4j"
    neo4j_password: str | None = None

    # LLM endpoints (OpenAI-compatible, vLLM / Ray Serve). Empty -> offline.
    # G1: LLM_REMOTE_BASE_URL is the documented go-live switch alias —
    # setting it flips the default tier from the offline synthesizer to the
    # remote serving tier (VLLM_BASE_URL takes precedence when both set).
    vllm_base_url: str | None = None
    vllm_api_key: str | None = None
    llm_timeout_seconds: float = 30.0

    default_seed: int = 42

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            host=os.getenv("HOST", "0.0.0.0"),
            port=int(os.getenv("PORT", "8081")),
            log_level=os.getenv("LOG_LEVEL", "INFO"),
            sql_dsn=os.getenv("SQL_DSN"),
            opensearch_url=os.getenv("OPENSEARCH_URL"),
            opensearch_index=os.getenv("OPENSEARCH_INDEX", "policy-passages"),
            neo4j_uri=os.getenv("NEO4J_URI"),
            neo4j_user=os.getenv("NEO4J_USER", "neo4j"),
            neo4j_password=os.getenv("NEO4J_PASSWORD"),
            vllm_base_url=(os.getenv("VLLM_BASE_URL")
                           or os.getenv("LLM_REMOTE_BASE_URL")),
            vllm_api_key=os.getenv("VLLM_API_KEY"),
            llm_timeout_seconds=float(os.getenv("LLM_TIMEOUT_SECONDS", "30")),
            default_seed=int(os.getenv("DEFAULT_SEED", "42")),
        )


settings = Settings.from_env()
