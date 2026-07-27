"""Typed pydantic models: evidence, recommendations, routing, envelopes."""
from __future__ import annotations

import enum
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Envelope & errors
# ---------------------------------------------------------------------------
class ErrorEnvelope(BaseModel):
    code: str
    message: str
    request_id: str
    retryable: bool = False
    details: dict[str, Any] = Field(default_factory=dict)


class Meta(BaseModel):
    request_id: str
    correlation_id: str
    api_version: str = "v1"


class Audit(BaseModel):
    actor_id: str = "anonymous"
    generated_at: datetime = Field(default_factory=utcnow)


class Envelope(BaseModel):
    data: Any = None
    meta: Meta
    audit: Audit = Field(default_factory=Audit)


# ---------------------------------------------------------------------------
# Evidence (spec section 39 canonical EvidenceSource)
# ---------------------------------------------------------------------------
class SourceType(str, enum.Enum):
    metric = "metric"
    legal = "legal"
    policy = "policy"
    profile = "profile"


class RetrievalPath(str, enum.Enum):
    sql = "sql"
    vector = "vector"
    graph = "graph"


class EvidenceSource(BaseModel):
    evidence_source_id: str
    source_type: SourceType
    citation: str
    retrieval_path: RetrievalPath
    confidence: float = Field(ge=0.0, le=1.0)
    content: str
    attributes: dict[str, Any] = Field(default_factory=dict)


class EvidenceBundle(BaseModel):
    bundle_id: str
    query: str
    jurisdiction_id: str
    evidence: list[EvidenceSource] = Field(default_factory=list)
    retrieval_paths_used: list[RetrievalPath] = Field(default_factory=list)
    adapter_modes: dict[str, str] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Retrieval API
# ---------------------------------------------------------------------------
class RetrieveRequest(BaseModel):
    query: str = Field(min_length=1)
    jurisdiction_id: str = "jur:ng"
    filters: dict[str, Any] = Field(default_factory=dict)
    top_k: int = Field(default=10, ge=1, le=50)


# ---------------------------------------------------------------------------
# Recommendation contract (spec section 9.2)
# ---------------------------------------------------------------------------
class BudgetRange(BaseModel):
    low_ngn_m: float
    high_ngn_m: float
    notes: str = ""


class TimelinePhase(BaseModel):
    phase: str
    duration_months: int
    milestones: list[str] = Field(default_factory=list)


class RiskItem(BaseModel):
    risk: str
    likelihood: Literal["low", "medium", "high"] = "medium"
    impact: Literal["low", "medium", "high"] = "medium"
    mitigation: str = ""


class KPI(BaseModel):
    name: str
    target: str
    measurement: str


class SimulationScenarioRef(BaseModel):
    engine: str
    description: str
    suggested_parameters: dict[str, Any] = Field(default_factory=dict)


class Recommendation(BaseModel):
    recommendation_id: str
    title: str
    rationale: str
    assumptions: list[str]
    evidence_base: list[EvidenceSource]
    estimated_jobs: int
    budget_ranges: list[BudgetRange]
    timeline: list[TimelinePhase]
    implementation_actors: list[str]
    legal_dependencies: list[str]
    risk_register: list[RiskItem]
    kpis: list[KPI]
    simulation_scenarios: list[SimulationScenarioRef]
    confidence: float = Field(ge=0.0, le=1.0)
    model_routing: "RoutingMetadata"


class RecommendationRequest(BaseModel):
    query: str = Field(min_length=1)
    jurisdiction_id: str = "jur:ng"
    sector: str | None = None
    workload_class: str = "interactive_copilot"
    filters: dict[str, Any] = Field(default_factory=dict)
    top_k: int = Field(default=10, ge=1, le=50)


# ---------------------------------------------------------------------------
# Copilot (SR-8)
# ---------------------------------------------------------------------------
class CopilotQuery(BaseModel):
    query: str = Field(min_length=1)
    jurisdiction_id: str = "jur:ng"
    workload_class: str = "interactive_copilot"
    top_k: int = Field(default=8, ge=1, le=30)


class CopilotAnswer(BaseModel):
    answer: str
    citations: list[str]
    evidence: list[EvidenceSource]
    uncertainty: Literal["low", "medium", "high"]
    confidence: float = Field(ge=0.0, le=1.0)
    model_routing: "RoutingMetadata"


# ---------------------------------------------------------------------------
# LLM routing (spec section 21)
# ---------------------------------------------------------------------------
class ModelTier(str, enum.Enum):
    qwen3_32b = "qwen3-32b"
    qwen3_235b = "qwen3-235b-a22b"
    deepseek_r1 = "deepseek-r1"
    qwen3_small = "qwen3-small"
    offline = "offline-synthesizer"


class WorkloadClass(str, enum.Enum):
    interactive_copilot = "interactive_copilot"
    premium_synthesis = "premium_synthesis"
    hard_analysis = "hard_analysis"
    batch = "batch"


class RoutingMetadata(BaseModel):
    workload_class: WorkloadClass
    selected_tier: ModelTier
    endpoint: str
    attempts: list[dict[str, Any]] = Field(default_factory=list)
    queue: Literal["interactive", "batch"]
    canary_model_version: str | None = None
    prompt_bundle: str
    fallback_used: bool = False
    offline: bool = False
    decision_id: str


class RoutingAuditEntry(BaseModel):
    decision_id: str
    request_id: str
    timestamp: datetime = Field(default_factory=utcnow)
    workload_class: WorkloadClass
    selected_tier: ModelTier
    queue: str
    attempts: list[dict[str, Any]]
    fallback_used: bool
    offline: bool
    latency_ms: float
    prompt_tokens: int = 0
    completion_tokens: int = 0
    circuit_breakers: dict[str, str] = Field(default_factory=dict)


Recommendation.model_rebuild()
CopilotAnswer.model_rebuild()
