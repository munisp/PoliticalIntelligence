"""Engine protocol and registry (spec sections 22-23).

Each engine is a clean module exposing:
  ENGINE_VERSION: str
  run(ctx: EngineContext) -> EngineResult

All engines are deterministic given ``ctx.random_seed`` and must return
uncertainty bands alongside point estimates.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app import CODE_VERSION
from app.data import seed as seed_data
from app.models import EngineResult, Reproducibility, ScenarioConfig, ModelPlanEntry


@dataclass
class EngineContext:
    """Inputs passed to every engine.

    ``panel`` (G2): optional realized-data panel — a list of unit records
    (dicts with treated/outcome/covariates) or aggregated outcome
    observations (dicts with period/indicator/value). When present, engines
    that support realized data (causal) use it instead of their synthetic
    panel and record ``data_mode: "realized"`` in result metadata."""
    config: ScenarioConfig
    plan: ModelPlanEntry
    jurisdiction: seed_data.Jurisdiction
    assumptions: seed_data.AssumptionsSet
    random_seed: int
    panel: list[dict] | None = None

    @property
    def rng(self) -> np.random.Generator:
        return np.random.default_rng(self.random_seed)

    @property
    def horizon_months(self) -> int:
        return self.plan.horizon_months


def build_reproducibility(engine_version: str, random_seed: int) -> Reproducibility:
    return Reproducibility(
        code_version=CODE_VERSION,
        engine_version=engine_version,
        seed_data_version=seed_data.SEED_DATA_VERSION,
        random_seed=random_seed,
    )


def horizon_labels(ctx: EngineContext) -> list[str]:
    """Monthly period labels for the engine horizon, continuing after 2026-12."""
    labels = []
    year, month = 2027, 1
    for i in range(ctx.horizon_months):
        m = (month - 1 + i) % 12 + 1
        y = year + (month - 1 + i) // 12
        labels.append(f"{y}-{m:02d}")
    return labels


def band_from_samples(samples: np.ndarray, level: float = 0.9):
    """Percentile bootstrap band from a (n_samples, n_periods) matrix."""
    alpha = (1.0 - level) / 2.0
    lower = np.quantile(samples, alpha, axis=0)
    upper = np.quantile(samples, 1.0 - alpha, axis=0)
    from app.models import UncertaintyBand
    return UncertaintyBand(
        lower=[round(float(v), 4) for v in lower],
        upper=[round(float(v), 4) for v in upper],
        level=level,
    )


def resolve_jurisdiction(jurisdiction_id: str) -> seed_data.Jurisdiction:
    jur = seed_data.JURISDICTIONS.get(jurisdiction_id)
    if jur is None:
        from app.errors import ValidationError
        raise ValidationError(
            f"Unknown jurisdiction_id '{jurisdiction_id}'",
            details={"known": sorted(seed_data.JURISDICTIONS)},
        )
    return jur


def resolve_assumptions(assumptions_id: str) -> seed_data.AssumptionsSet:
    asm = seed_data.ASSUMPTION_SETS.get(assumptions_id)
    if asm is None:
        from app.errors import ValidationError
        raise ValidationError(
            f"Unknown assumptions_set '{assumptions_id}'",
            details={"known": sorted(seed_data.ASSUMPTION_SETS)},
        )
    return asm


def run_engine(name: str, ctx: EngineContext) -> EngineResult:
    """Dispatch to the requested engine module."""
    from app.engines import (abm, causal, forecast, microsim,
                             optimization, system_dynamics)
    registry = {
        "forecast": forecast,
        "causal": causal,
        "microsim": microsim,
        "abm": abm,
        "system_dynamics": system_dynamics,
        "optimization": optimization,
    }
    module = registry.get(name)
    if module is None:
        from app.errors import ValidationError
        raise ValidationError(f"Unknown engine '{name}'",
                              details={"known": sorted(registry)})
    return module.run(ctx)


def intervention_scale(ctx: EngineContext) -> float:
    """Aggregate intensity scale of configured interventions (0..1+)."""
    if not ctx.config.interventions:
        return 0.1
    return float(sum(i.intensity for i in ctx.config.interventions)
                 / len(ctx.config.interventions))
