"""Binary document/artifact store.

Local filesystem by default (sha256-addressed under ./artifacts/documents/).
S3/MinIO adapter is used when DOCUMENTS_S3_BUCKET is set (boto3 optional —
imported lazily so the service runs without it).
"""
from __future__ import annotations

import hashlib
from pathlib import Path

from app.config import settings
from app.logging_setup import get_logger

log = get_logger("storage")


class DocumentStore:
    """Content-addressed binary store with an S3/MinIO mirror."""

    def __init__(
        self,
        artifacts_dir: str | None = None,
        bucket: str | None = None,
        endpoint_url: str | None = None,
    ):
        self.root = Path(artifacts_dir or settings.artifacts_dir)
        self.root.mkdir(parents=True, exist_ok=True)
        self.bucket = bucket if bucket is not None else settings.s3_bucket
        self.endpoint_url = (
            endpoint_url
            if endpoint_url is not None
            else settings.s3_endpoint_url
        )
        self._s3 = None

    # ------------------------------------------------------------------
    def _client(self):
        if self._s3 is None:
            import boto3  # optional heavy dep, lazy import

            self._s3 = boto3.client(
                "s3",
                endpoint_url=self.endpoint_url,
                region_name=settings.s3_region,
                aws_access_key_id=settings.s3_access_key,
                aws_secret_access_key=settings.s3_secret_key,
            )
        return self._s3

    @property
    def s3_enabled(self) -> bool:
        return bool(self.bucket)

    # ------------------------------------------------------------------
    def put(self, data: bytes, suffix: str = "") -> str:
        """Store bytes; returns uri `local://<sha256><suffix>`.

        When S3 is configured the object is mirrored to the bucket and the
        returned uri is `s3://<bucket>/<sha256><suffix>` (local copy kept as
        cache)."""
        digest = hashlib.sha256(data).hexdigest()
        key = f"{digest}{suffix}"
        path = self.root / key
        if not path.exists():
            path.write_bytes(data)
        if self.s3_enabled:
            try:
                self._client().put_object(Bucket=self.bucket, Key=key, Body=data)
                return f"s3://{self.bucket}/{key}"
            except Exception as exc:  # degrade to local-only with warning
                log.warning("s3 mirror failed, keeping local copy: %s", exc)
        return f"local://{key}"

    def get(self, uri: str) -> bytes:
        if uri.startswith("local://"):
            return (self.root / uri[len("local://"):]).read_bytes()
        if uri.startswith("s3://"):
            _, _, rest = uri.partition("s3://")
            _, _, key = rest.partition("/")
            cache = self.root / key
            if cache.exists():
                return cache.read_bytes()
            obj = self._client().get_object(Bucket=self.bucket, Key=key)
            data = obj["Body"].read()
            cache.write_bytes(data)
            return data
        raise ValueError(f"Unsupported artifact uri: {uri}")

    def exists(self, uri: str) -> bool:
        if uri.startswith("local://"):
            return (self.root / uri[len("local://"):]).exists()
        if uri.startswith("s3://"):
            return (self.root / uri[len("s3://"):].split("/", 1)[1]).exists()
        return False
