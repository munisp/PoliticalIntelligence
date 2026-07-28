"""Pydantic models: envelope, ingestion jobs, canonical entities, provenance."""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Standard envelope (design.md §9 — same shape as services/simulation)
# ---------------------------------------------------------------------------
class Meta(BaseModel):
    request_id: str
    correlation_id: str
    api_version: str = "v1"


class Audit(BaseModel):
    actor_id: str = "anonymous"
    generated_at: datetime = Field(default_factory=utcnow)


class Envelope(BaseModel):
    data: Any
    meta: Meta
    audit: Audit


class ErrorEnvelope(BaseModel):
    code: str
    message: str
    request_id: str
    retryable: bool = False
    details: dict = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Provenance — every record carries where it came from
# ---------------------------------------------------------------------------
Origin = Literal["live", "derived", "seed"]


class Provenance(BaseModel):
    origin: Origin = "live"
    source_id: str
    url: str | None = None
    fetched_at: datetime = Field(default_factory=utcnow)
    checksum: str | None = None
    license: str | None = None


class RawRecord(BaseModel):
    """A record as fetched, before normalization."""

    provenance: Provenance
    payload: dict


class ContractResult(BaseModel):
    schema_ok: bool
    freshness_ok: bool
    completeness_ok: bool
    records_in: int
    records_out: int
    notes: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Canonical entities (normalized output — matches db/schema.ts columns)
# ---------------------------------------------------------------------------
class CanonicalRecord(BaseModel):
    entity: Literal[
        "jurisdiction",
        "admin_unit",
        "sector_metric",
        "facility",
        "procurement_record",
        "data_source",
        "outcome_observation",
    ]
    data: dict
    provenance: Provenance


# ---------------------------------------------------------------------------
# Ingestion jobs (async, same lifecycle discipline as services/simulation)
# ---------------------------------------------------------------------------
class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"


class IngestRequest(BaseModel):
    jurisdiction: str = Field(min_length=1, description="Jurisdiction id, e.g. ng-kd")
    since: str | None = Field(
        default=None,
        description="Optional lower bound (year or ISO date) for fetched series",
    )
    params: dict = Field(
        default_factory=dict,
        description="Connector-specific options (indicators, area name, queries...)",
    )


class JobPublic(BaseModel):
    job_id: str
    connector: str
    status: JobStatus
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    records_in: int = 0
    records_out: int = 0
    artifact: str | None = None
    contract: ContractResult | None = None
    loader: dict | None = None
    error: str | None = None


class ConnectorStatus(BaseModel):
    name: str
    description: str
    live: bool
    last_fetch_at: datetime | None = None
    last_job: JobPublic | None = None
    total_records: int = 0
