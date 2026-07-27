"""Four-layer digital twin state model (spec section 23).

Layers:
  descriptive — observed baseline indicators (from seed data / registries)
  behavioral  — calibrated agent/flow parameters learned from scenario runs
  policy      — active interventions and rule sets
  adaptive    — running calibration state updated after every scenario run

Twin state is versioned and persisted per jurisdiction; each scenario run
evolves the twin (adaptive layer) so subsequent runs start from the latest
calibrated state.
"""
from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field

from app.data import seed as seed_data
from app.logging_setup import get_logger

log = get_logger("twin")


class DescriptiveLayer(BaseModel):
    indicators: dict[str, float] = Field(default_factory=dict)
    as_of: str = "2024-01"


class BehavioralLayer(BaseModel):
    hiring_elasticity: float = 0.5
    subsidy_takeup: float = 0.55
    firm_birth_rate: float = 0.04
    calibrated_from_runs: int = 0


class PolicyLayer(BaseModel):
    active_interventions: list[dict[str, Any]] = Field(default_factory=list)
    assumptions_set: str = "asm:edu:base"


class AdaptiveLayer(BaseModel):
    calibration_drift: float = 0.0
    last_run_id: str | None = None
    last_updated: str | None = None
    notes: list[str] = Field(default_factory=list)


class TwinState(BaseModel):
    jurisdiction_id: str
    version: int = 0
    descriptive: DescriptiveLayer = Field(default_factory=DescriptiveLayer)
    behavioral: BehavioralLayer = Field(default_factory=BehavioralLayer)
    policy: PolicyLayer = Field(default_factory=PolicyLayer)
    adaptive: AdaptiveLayer = Field(default_factory=AdaptiveLayer)


class TwinRegistry:
    """In-process, thread-safe twin registry persisted via the artifact store."""

    def __init__(self, store=None):
        self._lock = threading.Lock()
        self._twins: dict[str, TwinState] = {}
        self._store = store

    def get_or_create(self, jurisdiction_id: str) -> TwinState:
        with self._lock:
            if jurisdiction_id in self._twins:
                return self._twins[jurisdiction_id]
            jur = seed_data.JURISDICTIONS.get(jurisdiction_id)
            if jur is None:
                from app.errors import ValidationError
                raise ValidationError(f"Unknown jurisdiction_id '{jurisdiction_id}'")
            twin = TwinState(
                jurisdiction_id=jurisdiction_id,
                descriptive=DescriptiveLayer(indicators={
                    "population": float(jur.population),
                    "labour_force": float(jur.labour_force),
                    "baseline_unemployment_rate": jur.baseline_unemployment_rate,
                    "gdp_ngn_bn": jur.gdp_ngn_bn,
                }),
            )
            self._twins[jurisdiction_id] = twin
            log.info("twin created", extra={"jurisdiction_id": jurisdiction_id})
            return twin

    def evolve(self, jurisdiction_id: str, run_id: str,
               engine_summaries: list[str]) -> TwinState:
        """Update adaptive/policy layers after a completed scenario run."""
        with self._lock:
            twin = self._twins[jurisdiction_id]
            twin.version += 1
            twin.behavioral.calibrated_from_runs += 1
            twin.adaptive.last_run_id = run_id
            twin.adaptive.last_updated = datetime.now(timezone.utc).isoformat()
            twin.adaptive.calibration_drift = round(
                twin.adaptive.calibration_drift * 0.9 + 0.01, 6)
            twin.adaptive.notes.append(
                f"run {run_id}: {' | '.join(engine_summaries)[:400]}")
            twin.adaptive.notes = twin.adaptive.notes[-20:]
            if self._store is not None:
                self._store.put_json(
                    f"twins/{jurisdiction_id}/twin-state-v{twin.version}.json",
                    twin.model_dump(mode="json"))
            return twin

    def snapshot(self, jurisdiction_id: str) -> TwinState | None:
        with self._lock:
            return self._twins.get(jurisdiction_id)
