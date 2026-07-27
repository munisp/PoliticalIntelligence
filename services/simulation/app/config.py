"""Environment-driven configuration with sane defaults."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    service_name: str = "simulation-engine"
    api_version: str = "v1"
    host: str = "0.0.0.0"
    port: int = 8080
    log_level: str = "INFO"

    # Artifacts (spec section 10 reproducibility)
    artifact_dir: Path = Path("./artifacts")
    s3_endpoint_url: str | None = None
    s3_bucket: str | None = None
    s3_access_key: str | None = None
    s3_secret_key: str | None = None
    s3_region: str = "us-east-1"

    # Async workers
    worker_count: int = 4
    max_queue_size: int = 256
    job_ttl_seconds: int = 86400

    # Determinism
    default_seed: int = 42

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            host=os.getenv("HOST", "0.0.0.0"),
            port=int(os.getenv("PORT", "8080")),
            log_level=os.getenv("LOG_LEVEL", "INFO"),
            artifact_dir=Path(os.getenv("ARTIFACT_DIR", "./artifacts")),
            s3_endpoint_url=os.getenv("S3_ENDPOINT_URL"),
            s3_bucket=os.getenv("S3_BUCKET"),
            s3_access_key=os.getenv("S3_ACCESS_KEY"),
            s3_secret_key=os.getenv("S3_SECRET_KEY"),
            s3_region=os.getenv("S3_REGION", "us-east-1"),
            worker_count=int(os.getenv("WORKER_COUNT", "4")),
            max_queue_size=int(os.getenv("MAX_QUEUE_SIZE", "256")),
            job_ttl_seconds=int(os.getenv("JOB_TTL_SECONDS", "86400")),
            default_seed=int(os.getenv("DEFAULT_SEED", "42")),
        )


settings = Settings.from_env()
