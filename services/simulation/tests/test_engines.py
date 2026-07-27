"""Each engine must return a valid typed EngineResult with uncertainty bands."""
from __future__ import annotations

import pytest

from app.engines import (EngineContext, resolve_assumptions,
                         resolve_jurisdiction)
from app.engines import abm, causal, forecast, microsim, optimization, system_dynamics
from app.models import (EngineResult, EngineName, Intervention, ModelPlanEntry,
                        ScenarioConfig)

ALL_ENGINES = [
    ("forecast", forecast),
    ("causal", causal),
    ("microsim", microsim),
    ("abm", abm),
    ("system_dynamics", system_dynamics),
    ("optimization", optimization),
]


def make_ctx(engine: str, seed: int = 42, **params) -> EngineContext:
    config = ScenarioConfig(
        jurisdiction_id="jur:ng-kd",
        assumptions_set="asm:sme:base",
        interventions=[Intervention(
            intervention_id="iv:test", name="Test wage subsidy", sector="sme",
            kind="wage_subsidy", budget_ngn_m=500, intensity=0.6)],
        model_plan=[ModelPlanEntry(engine=EngineName(engine),
                                   horizon_months=12, parameters=params)],
        random_seed=seed,
    )
    return EngineContext(
        config=config,
        plan=config.model_plan[0],
        jurisdiction=resolve_jurisdiction(config.jurisdiction_id),
        assumptions=resolve_assumptions(config.assumptions_set),
        random_seed=seed,
    )


@pytest.mark.parametrize("name,module", ALL_ENGINES, ids=[n for n, _ in ALL_ENGINES])
def test_engine_returns_valid_typed_output(name, module):
    result = module.run(make_ctx(name))
    assert isinstance(result, EngineResult)
    assert result.engine.value == name
    assert result.status == "succeeded"
    assert result.engine_version
    assert result.model_version
    assert result.reproducibility.random_seed == 42
    assert result.reproducibility.code_version
    # at least one quantitative output
    assert result.series or result.estimates or result.distribution_impacts


@pytest.mark.parametrize("name,module", ALL_ENGINES, ids=[n for n, _ in ALL_ENGINES])
def test_engine_outputs_have_uncertainty_bands(name, module):
    result = module.run(make_ctx(name))
    has_band = (
        any(s.band is not None for s in result.series)
        or any(d.band is not None for d in result.distribution_impacts)
        or any(e.ci_lower <= e.estimate <= e.ci_upper for e in result.estimates)
    )
    assert has_band, f"{name} produced no uncertainty information"


@pytest.mark.parametrize("name,module", ALL_ENGINES, ids=[n for n, _ in ALL_ENGINES])
def test_engine_deterministic_same_seed(name, module):
    r1 = module.run(make_ctx(name, seed=7))
    r2 = module.run(make_ctx(name, seed=7))
    assert r1.model_dump(mode="json") == r2.model_dump(mode="json")


@pytest.mark.parametrize("name,module", ALL_ENGINES, ids=[n for n, _ in ALL_ENGINES])
def test_engine_seed_changes_output(name, module):
    r1 = module.run(make_ctx(name, seed=1))
    r2 = module.run(make_ctx(name, seed=2))
    assert r1.model_dump(mode="json") != r2.model_dump(mode="json")
