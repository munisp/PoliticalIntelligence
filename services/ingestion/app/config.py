"""Runtime configuration (env-driven, 12-factor)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Settings:
    service_name: str = "ingestion"
    api_version: str = "v1"
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    artifacts_dir: str = os.getenv(
        "INGESTION_ARTIFACTS_DIR",
        os.path.join(os.getcwd(), "artifacts", "ingestion"),
    )
    kafka_brokers: str = os.getenv("KAFKA_BROKERS", "")
    http_timeout_s: float = float(os.getenv("INGESTION_HTTP_TIMEOUT_S", "60"))
    # Descriptive UA — Overpass and HDX ask clients to identify themselves.
    user_agent: str = os.getenv(
        "INGESTION_USER_AGENT",
        "MeridianPolicyTwin-Ingestion/1.0 (policy-research; contact: data@example.org)",
    )
    overpass_mirrors: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            m.strip()
            for m in os.getenv(
                "OVERPASS_MIRRORS",
                "https://overpass.kumi.systems/api/interpreter,"
                "https://overpass-api.de/api/interpreter",
            ).split(",")
            if m.strip()
        )
    )


settings = Settings()
