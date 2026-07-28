"""Environment-driven configuration with sane defaults."""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    service_name: str = "documents-legal"
    api_version: str = "v1"
    host: str = "0.0.0.0"
    port: int = 8400
    log_level: str = "INFO"

    # Binary artifact store. Local dir by default; S3/MinIO when bucket set.
    artifacts_dir: str = "./artifacts/documents"
    s3_bucket: str | None = None
    s3_endpoint_url: str | None = None  # MinIO: http://localhost:9000
    s3_region: str = "us-east-1"
    s3_access_key: str | None = None
    s3_secret_key: str | None = None

    # OCR backends. All optional — deterministic fallbacks keep the
    # pipeline fully functional without heavy deps.
    ocr_backend: str = "auto"  # auto | docling | paddle | vlm
    paddle_lang: str = "en"

    # VLM endpoint (OpenAI-compatible vision chat, e.g. vLLM serving
    # Qwen2.5-VL / Qwen3-VL). Empty -> deterministic heuristic fallback.
    vllm_base_url: str | None = None
    vllm_api_key: str | None = None
    vlm_model: str = "Qwen/Qwen2.5-VL-7B-Instruct"
    vlm_timeout_seconds: float = 60.0

    # Spec BR-4: pages below this OCR confidence go to human review.
    review_confidence_threshold: float = 0.75

    max_upload_bytes: int = 10 * 1024 * 1024  # 10MB, mirrored by API layer

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            host=os.getenv("HOST", "0.0.0.0"),
            port=int(os.getenv("PORT", "8400")),
            log_level=os.getenv("LOG_LEVEL", "INFO"),
            artifacts_dir=os.getenv(
                "DOCUMENTS_ARTIFACTS_DIR", "./artifacts/documents"),
            s3_bucket=os.getenv("DOCUMENTS_S3_BUCKET"),
            s3_endpoint_url=os.getenv("DOCUMENTS_S3_ENDPOINT_URL"),
            s3_region=os.getenv("DOCUMENTS_S3_REGION", "us-east-1"),
            s3_access_key=os.getenv("DOCUMENTS_S3_ACCESS_KEY"),
            s3_secret_key=os.getenv("DOCUMENTS_S3_SECRET_KEY"),
            ocr_backend=os.getenv("OCR_BACKEND", "auto"),
            paddle_lang=os.getenv("PADDLE_LANG", "en"),
            vllm_base_url=os.getenv("VLLM_BASE_URL"),
            vllm_api_key=os.getenv("VLLM_API_KEY"),
            vlm_model=os.getenv(
                "VLM_MODEL", "Qwen/Qwen2.5-VL-7B-Instruct"),
            vlm_timeout_seconds=float(os.getenv("VLM_TIMEOUT_SECONDS", "60")),
            review_confidence_threshold=float(
                os.getenv("REVIEW_CONFIDENCE_THRESHOLD", "0.75")),
        )


settings = Settings.from_env()
