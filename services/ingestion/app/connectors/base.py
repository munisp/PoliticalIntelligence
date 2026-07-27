"""Connector protocol.

Every connector implements:
  fetch()        -> list[RawRecord]      raw payloads with full provenance
  normalize()    -> list[CanonicalRecord] canonical entity dicts
  contract_check() -> ContractResult     schema/freshness/completeness gate

Every record — raw and canonical — carries a Provenance label
(origin: "live" | "derived" | "seed", source_id, url, fetched_at,
checksum, license). Nothing enters the platform without it.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Protocol, runtime_checkable

import httpx

from app.config import settings
from app.errors import ServiceError
from app.models import (CanonicalRecord, ContractResult, Provenance,
                        RawRecord, utcnow)


def checksum_bytes(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def checksum_json(payload: Any) -> str:
    return checksum_bytes(
        json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    )


@runtime_checkable
class Connector(Protocol):
    name: str
    description: str

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]: ...

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]: ...

    def contract_check(
        self, raw: list[RawRecord], normalized: list[CanonicalRecord]
    ) -> ContractResult: ...


class BaseConnector:
    """Shared HTTP/provenance/contract plumbing for concrete connectors."""

    name = "base"
    description = "abstract connector"
    source_id = "base"
    license = "unknown"
    max_record_age_days = 370  # annual statistics cadence by default

    def __init__(self, client: httpx.Client | None = None):
        self._client = client

    # -- HTTP -------------------------------------------------------------
    @property
    def client(self) -> httpx.Client:
        if self._client is None:
            self._client = httpx.Client(
                timeout=settings.http_timeout_s,
                headers={"User-Agent": settings.user_agent},
                follow_redirects=True,
            )
        return self._client

    def get_json(self, url: str, **kwargs) -> Any:
        try:
            resp = self.client.get(url, **kwargs)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as exc:
            raise ServiceError(
                code="SOURCE_FETCH_FAILED",
                message=f"{self.name}: GET {url} failed: {exc}",
                http_status=502,
                retryable=True,
            ) from exc

    # -- provenance ---------------------------------------------------------
    def provenance(
        self,
        url: str | None,
        payload: Any,
        fetched_at: datetime | None = None,
        origin: str = "live",
    ) -> Provenance:
        return Provenance(
            origin=origin,  # type: ignore[arg-type]
            source_id=self.source_id,
            url=url,
            fetched_at=fetched_at or utcnow(),
            checksum=checksum_json(payload),
            license=self.license,
        )

    # -- contract ------------------------------------------------------------
    REQUIRED_KEYS: tuple[str, ...] = ()

    def contract_check(
        self, raw: list[RawRecord], normalized: list[CanonicalRecord]
    ) -> ContractResult:
        notes: list[str] = []
        schema_ok = True
        for rec in normalized:
            missing = [k for k in self.REQUIRED_KEYS if k not in rec.data]
            if missing:
                schema_ok = False
                notes.append(
                    f"{rec.entity} record missing keys {missing}: "
                    f"{str(rec.data)[:120]}"
                )
        now = datetime.now(timezone.utc)
        freshness_ok = all(
            (now - r.provenance.fetched_at).days <= self.max_record_age_days
            for r in raw
        )
        if not freshness_ok:
            notes.append("some raw records exceed freshness budget")
        completeness_ok = len(normalized) > 0 or len(raw) == 0
        if raw and not normalized:
            notes.append("fetch returned records but normalization produced none")
        return ContractResult(
            schema_ok=schema_ok,
            freshness_ok=freshness_ok,
            completeness_ok=completeness_ok,
            records_in=len(raw),
            records_out=len(normalized),
            notes=notes,
        )
