"""Pydantic models: envelope, jobs, OCR pages, clauses, quality reports."""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Standard envelope (same shape as services/ingestion, services/simulation)
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
# Jobs (per-stage status, spec §18 pipeline lifecycle)
# ---------------------------------------------------------------------------
PIPELINE_STAGES = (
    "upload", "extract", "segment", "legal_nlp", "structure", "review_routing",
)


class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"


class StageStatus(BaseModel):
    name: str
    status: Literal["pending", "running", "succeeded", "failed", "skipped"] = (
        "pending"
    )
    started_at: datetime | None = None
    finished_at: datetime | None = None
    detail: str | None = None


class DocumentJob(BaseModel):
    job_id: str
    document_id: str
    status: JobStatus = JobStatus.queued
    created_at: datetime = Field(default_factory=utcnow)
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None
    stages: list[StageStatus] = Field(
        default_factory=lambda: [StageStatus(name=s) for s in PIPELINE_STAGES]
    )
    artifacts: dict[str, str] = Field(default_factory=dict)  # kind -> uri
    ocr_confidence: float | None = None
    processing_mode: str = "full"  # full | fallback
    review_flags: list[dict] = Field(default_factory=list)
    meta: dict = Field(default_factory=dict)  # title/jurisdiction/doc_type


# ---------------------------------------------------------------------------
# OCR / extraction domain
# ---------------------------------------------------------------------------
class TextSpan(BaseModel):
    text: str
    confidence: float = 1.0
    bbox: list[float] | None = None  # [x0, y0, x1, y1]


class Page(BaseModel):
    page_number: int
    kind: Literal["text_pdf", "scanned", "image", "docx", "text"] = "text_pdf"
    spans: list[TextSpan] = Field(default_factory=list)
    backend: str = "unknown"
    needs_review: bool = False

    @property
    def text(self) -> str:
        return "\n".join(s.text for s in self.spans if s.text.strip())

    @property
    def confidence(self) -> float:
        vals = [s.confidence for s in self.spans if s.text.strip()]
        return round(sum(vals) / len(vals), 4) if vals else 0.0


class ExtractionResult(BaseModel):
    pages: list[Page]
    backend: str
    structure: dict = Field(default_factory=dict)  # sections/tables/reading order
    fallback_used: bool = False

    @property
    def full_text(self) -> str:
        return "\n\n".join(p.text for p in self.pages if p.text.strip())

    @property
    def mean_confidence(self) -> float:
        vals = [p.confidence for p in self.pages if p.spans]
        return round(sum(vals) / len(vals), 4) if vals else 0.0


# ---------------------------------------------------------------------------
# Legal NLP domain
# ---------------------------------------------------------------------------
class Obligation(BaseModel):
    kind: Literal["obligation", "prohibition", "permission"]
    actor: str | None = None
    action: str
    condition: str | None = None
    modal: str


class Citation(BaseModel):
    raw: str
    target_title: str | None = None
    target_year: int | None = None
    section_ref: str | None = None
    relation: Literal["CITES", "AMENDS", "REPEALS", "ENABLES", "RESTRICTS"] = (
        "CITES"
    )


class Clause(BaseModel):
    clause_id: str
    section_path: str  # e.g. "s.15(2)(a)"
    heading: str | None = None
    text: str
    kind: Literal["section", "definition", "proviso", "schedule", "preamble"] = (
        "section"
    )
    confidence: float = 0.9
    obligations: list[Obligation] = Field(default_factory=list)
    defined_terms: list[str] = Field(default_factory=list)
    citations: list[Citation] = Field(default_factory=list)
    page: int | None = None


class CitationEdge(BaseModel):
    from_clause: str
    to_ref: str  # resolved clause id or external citation string
    relation: str
    resolved: bool = False


class QualityReport(BaseModel):
    document_id: str
    page_count: int
    mean_ocr_confidence: float
    confidence_distribution: dict[str, int]  # bucket -> pages
    low_confidence_pages: list[int]
    backend_used: str
    fallback_used: bool
    clause_count: int
    obligation_count: int
    defined_term_count: int
    citation_count: int
    review_flags: list[dict] = Field(default_factory=list)
    stages: list[StageStatus] = Field(default_factory=list)
