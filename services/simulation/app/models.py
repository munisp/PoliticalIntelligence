"""Typed pydantic models for the scenario & simulation engine."""
from __future__ import annotations

import enum
from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, Field


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Error envelope (spec: {code, message, request_id, retryable, details})
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
# Scenario configuration
# ---------------------------------------------------------------------------
class EngineName(str, enum.Enum):
    forecast = "forecast"
    causal = "causal"
    microsim = "microsim"
    abm = "abm"
    system_dynamics = "system_dynamics"
    optimization = "optimization"


class Intervention(BaseModel):
    """A single policy intervention lever."""
    intervention_id: str
    name: str
    sector: str
    kind: Literal[
        "wage_subsidy", "tax_credit", "training_program",
        "cash_transfer", "procurement_reform", "infrastructure_investment",
    ] = "wage_subsidy"
    budget_ngn_m: float = Field(default=0.0, ge=0, description="Budget in NGN millions")
    target_population: int = Field(default=10000, gt=0)
    intensity: float = Field(default=0.5, ge=0.0, le=1.0)
    duration_months: int = Field(default=12, ge=1, le=120)
    parameters: dict[str, Any] = Field(default_factory=dict)


class ModelPlanEntry(BaseModel):
    engine: EngineName
    horizon_months: int = Field(default=24, ge=1, le=240)
    parameters: dict[str, Any] = Field(default_factory=dict)


class ScenarioConfig(BaseModel):
    scenario_id: str | None = None
    jurisdiction_id: str = Field(..., examples=["jur:ng-kd"])
    sector: str | None = None
    interventions: list[Intervention] = Field(default_factory=list)
    assumptions_set: str = Field(default="asm:edu:base")
    model_plan: list[ModelPlanEntry] = Field(
        default_factory=lambda: [ModelPlanEntry(engine=EngineName.forecast)]
    )
    random_seed: int | None = None
    label: str = ""


# ---------------------------------------------------------------------------
# Engine outputs
# ---------------------------------------------------------------------------
class UncertaintyBand(BaseModel):
    lower: list[float]
    upper: list[float]
    level: float = 0.9


class SeriesResult(BaseModel):
    metric: str
    unit: str = "count"
    periods: list[str]
    point: list[float]
    band: UncertaintyBand | None = None


class DistributionImpact(BaseModel):
    group: str
    baseline_mean: float
    scenario_mean: float
    delta: float
    band: UncertaintyBand | None = None


class ScalarEstimate(BaseModel):
    metric: str
    estimate: float
    ci_lower: float
    ci_upper: float
    p_value: float | None = None
    notes: str = ""


class Reproducibility(BaseModel):
    code_version: str
    engine_version: str
    seed_data_version: str
    random_seed: int


class ArtifactRef(BaseModel):
    name: str
    uri: str
    media_type: str = "application/json"
    size_bytes: int = 0


class EngineResult(BaseModel):
    engine: EngineName
    engine_version: str
    model_version: str
    status: Literal["succeeded", "failed"] = "succeeded"
    summary: str = ""
    series: list[SeriesResult] = Field(default_factory=list)
    estimates: list[ScalarEstimate] = Field(default_factory=list)
    distribution_impacts: list[DistributionImpact] = Field(default_factory=list)
    artifacts: list[ArtifactRef] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    reproducibility: Reproducibility


# ---------------------------------------------------------------------------
# Run lifecycle
# ---------------------------------------------------------------------------
class RunStatus(str, enum.Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    canceled = "canceled"


TERMINAL_STATES = {RunStatus.succeeded, RunStatus.failed, RunStatus.canceled}


class ScenarioRun(BaseModel):
    simulation_run_id: str
    status: RunStatus = RunStatus.queued
    progress: float = Field(default=0.0, ge=0.0, le=1.0)
    config: ScenarioConfig
    idempotency_key: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None
    engine_results: list[EngineResult] = Field(default_factory=list)
    artifacts: list[ArtifactRef] = Field(default_factory=list)
    reproducibility: Reproducibility | None = None


class ScenarioRunPublic(BaseModel):
    simulation_run_id: str
    status: RunStatus
    progress: float
    jurisdiction_id: str
    created_at: datetime
    finished_at: datetime | None = None
    error: str | None = None
    artifact_links: list[ArtifactRef] = Field(default_factory=list)
    results_link: str


class ScenarioRunResults(BaseModel):
    simulation_run_id: str
    status: RunStatus
    engine_results: list[EngineResult]
    twin_state_version: int
