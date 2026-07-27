"""Agent-based model engine (spec section 22).

Mesa-style step-based simulation of employment dynamics: worker and firm
agents interact through a simple matching process each month. Under an
intervention, subsidised firms post additional vacancies. If Mesa is
installed it can be enabled via parameters.use_mesa; the built-in scheduler
is default & deterministic.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from app.models import EngineName, EngineResult, SeriesResult
from app.engines import (EngineContext, band_from_samples, build_reproducibility,
                         horizon_labels, intervention_scale)

ENGINE_VERSION = "1.0.0"

try:  # optional heavy dependency
    import mesa  # noqa: F401
    _HAS_MESA = True
except Exception:  # pragma: no cover
    _HAS_MESA = False


@dataclass
class Firm:
    vacancies: int = 0
    employees: list[int] = field(default_factory=list)


def _single_run(rng: np.random.Generator, ctx: EngineContext,
                n_workers: int, n_firms: int) -> np.ndarray:
    h = ctx.horizon_months
    scale = intervention_scale(ctx)
    base_unemp = ctx.jurisdiction.baseline_unemployment_rate

    employed = rng.random(n_workers) > base_unemp
    firms = [Firm() for _ in range(n_firms)]
    for wid, emp in enumerate(employed):
        if emp:
            firms[rng.integers(0, n_firms)].employees.append(wid)

    quit_rate = 0.02
    match_prob = 0.18
    path = np.empty(h)
    for step in range(h):
        # separations
        for f in firms:
            leavers = [w for w in f.employees if rng.random() < quit_rate]
            for w in leavers:
                employed[w] = False
            f.employees = [w for w in f.employees if employed[w]]
        # vacancy creation (intervention lifts vacancies)
        subsidy_boost = 1.0 + 2.0 * scale
        for f in firms:
            base_vac = max(0, int(rng.poisson(0.5 * subsidy_boost)))
            f.vacancies = base_vac
        # matching
        unemployed_ids = np.where(~employed)[0]
        rng.shuffle(unemployed_ids)
        for wid in unemployed_ids:
            fid = int(rng.integers(0, n_firms))
            f = firms[fid]
            if f.vacancies > 0 and rng.random() < match_prob * subsidy_boost:
                f.vacancies -= 1
                f.employees.append(int(wid))
                employed[wid] = True
        path[step] = float(np.mean(employed))
    return path


def run(ctx: EngineContext) -> EngineResult:
    params = ctx.plan.parameters
    n_workers = int(params.get("n_workers", 3000))
    n_firms = int(params.get("n_firms", 400))
    n_reps = int(params.get("n_replications", 20))
    master = ctx.rng
    rep_seeds = master.integers(0, 2**31 - 1, size=n_reps)
    paths = np.stack([
        _single_run(np.random.default_rng(int(s)), ctx, n_workers, n_firms)
        for s in rep_seeds
    ])
    point = paths.mean(axis=0)
    band = band_from_samples(paths, level=0.9)
    series = SeriesResult(
        metric="employment_rate",
        unit="ratio",
        periods=horizon_labels(ctx),
        point=[round(float(v), 4) for v in point],
        band=band,
    )
    delta = point[-1] - point[0]
    return EngineResult(
        engine=EngineName.abm,
        engine_version=ENGINE_VERSION,
        model_version=f"matching-abm/{ENGINE_VERSION}",
        summary=(f"ABM with {n_workers} workers / {n_firms} firms over "
                 f"{ctx.horizon_months} months ({n_reps} replications); "
                 f"employment rate moves {point[0]:.3f} → {point[-1]:.3f}."),
        series=[series],
        metadata={
            "n_workers": n_workers, "n_firms": n_firms,
            "n_replications": n_reps,
            "employment_delta": round(float(delta), 4),
            "mesa_available": _HAS_MESA,
        },
        reproducibility=build_reproducibility(ENGINE_VERSION, ctx.random_seed),
    )
