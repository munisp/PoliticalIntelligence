"""Artifact storage: local JSON files + optional S3/MinIO upload adapter.

Artifacts are always written locally under ARTIFACT_DIR. When S3_* env config
is present and boto3 is installed, every artifact is also uploaded to the
configured bucket (spec section 10 reproducibility of outputs).
"""
from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

from app.config import settings
from app.logging_setup import get_logger

log = get_logger("storage")


class ArtifactStore:
    def __init__(self, root: Path | None = None):
        self.root = (root or settings.artifact_dir).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._s3 = None
        if settings.s3_bucket:
            try:
                import boto3  # optional dependency
                self._s3 = boto3.client(
                    "s3",
                    endpoint_url=settings.s3_endpoint_url,
                    aws_access_key_id=settings.s3_access_key,
                    aws_secret_access_key=settings.s3_secret_key,
                    region_name=settings.s3_region,
                )
                log.info("s3 adapter enabled", extra={"request_id": "-"})
            except Exception as exc:  # pragma: no cover - env dependent
                log.warning(f"s3 adapter disabled: {exc}")

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if not str(path).startswith(str(self.root)):
            raise ValueError(f"unsafe artifact key: {key}")
        return path

    def put_json(self, key: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Write JSON artifact locally; mirror to S3 when configured."""
        body = json.dumps(payload, indent=2, default=str).encode()
        with self._lock:
            path = self._path(key)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)
        uri = f"file://{path}"
        if self._s3 is not None:  # pragma: no cover - env dependent
            try:
                self._s3.put_object(Bucket=settings.s3_bucket, Key=key, Body=body,
                                    ContentType="application/json")
                endpoint = settings.s3_endpoint_url or "s3.amazonaws.com"
                uri = f"s3://{settings.s3_bucket}/{key} ({endpoint})"
            except Exception as exc:
                log.warning(f"s3 upload failed for {key}: {exc}")
        return {"name": Path(key).name, "uri": uri,
                "media_type": "application/json", "size_bytes": len(body)}

    def get_json(self, key: str) -> dict[str, Any] | None:
        path = self._path(key)
        if not path.exists():
            return None
        return json.loads(path.read_text())
