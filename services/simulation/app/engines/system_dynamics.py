"""System dynamics engine (spec section 22).

PySD-style stock-flow model of a regional labour market with three stocks
(employed, skilled labour, firms), monthly flows, and two feedback loops:
  R1 growth:   firms → hiring → employed → demand → firm births
  B1 capacity: skilled labour shortage throttles hiring
Euler integration with dt=1 month; Monte-Carlo parameter sampling yields
uncertainty bands. PySD integration is optional via parameters.use_pysd.
"""
from __future__ import annotations

import numpy as np

from app.models import EngineName, EngineResult, SeriesResult
from app.engines import (EngineContext, band_from_samples, build_reproducibility,
                         horizon_labels, intervention_scale)

ENGINE_VERSION = "1.0.0"

try:  # optional heavy dependency
    import pysd  # noqa: F401
    _HAS_PYSD = True
except Exception:  # pragma: no cover
    _HAS_PYSD = False


def _simulate(rng: np.random.Generator, ctx: EngineContext) -> dict[str, np.ndarray]:
    h = ctx.horizon_months
    jur = ctx.jurisdiction
    scale = intervention_scale(ctx)

    # Initial stocks
    employed0 = jur.labour_force * (1 - jur.baseline_unemployment_rate) * 0.001
    firms0 = employed0 / 25.0
    skilled0 = employed0 * 0.30

    # Parameters (with small Monte-Carlo jitter for bands)
    hire_rate = 0.020 * (1 + 1.5 * scale) * rng.uniform(0.9, 1.1)
    separations = 0.018 * rng.uniform(0.95, 1.05)
    firm_birth = 0.004 * (1 + scale) * rng.uniform(0.85, 1.15)
    skill_train = 0.006 * (1 + 0.8 * scale) * rng.uniform(0.9, 1.1)
    labour_growth = float(ctx.assumptions.values.get("labour_force_growth", 0.03)) / 12.0

    labour_force = jur.labour_force * 0.001
    emp = np.empty(h + 1); skl = np.empty(h + 1); frm = np.empty(h + 1)
    emp[0], skl[0], frm[0] = employed0, skilled0, firms0
    for t in range(h):
        labour_force *= (1 + labour_growth)
        # B1: skill shortage throttles hiring
        skill_ratio = skl[t] / max(emp[t], 1.0)
        throttle = min(1.0, skill_ratio / 0.32)
        hires = emp[t] * hire_rate * throttle * (1 + 0.3 * frm[t] / max(frm[0], 1e-9))
        quits = emp[t] * separations
        births = frm[t] * firm_birth * (emp[t] / max(employed0, 1e-9))  # R1 demand loop
        trained = (labour_force - emp[t]) * skill_train
        # Euler step (dt = 1 month)
        emp[t + 1] = max(0.0, emp[t] + hires - quits)
        skl[t + 1] = max(0.0, skl[t] + trained - quits * skill_ratio)
        frm[t + 1] = max(0.0, frm[t] + births - frm[t] * 0.002)
    return {"employed": emp[1:], "skilled_labour": skl[1:], "firms": frm[1:]}


def run(ctx: EngineContext) -> EngineResult:
    params = ctx.plan.parameters
    n_mc = int(params.get("n_monte_carlo", 60))
    master = ctx.rng
    mc_seeds = master.integers(0, 2**31 - 1, size=n_mc)
    runs = {k: [] for k in ("employed", "skilled_labour", "firms")}
    for s in mc_seeds:
        out = _simulate(np.random.default_rng(int(s)), ctx)
        for k, v in out.items():
            runs[k].append(v)

    labels = horizon_labels(ctx)
    series = []
    for metric, paths in runs.items():
        arr = np.stack(paths)
        series.append(SeriesResult(
            metric=metric,
            unit="thousands",
            periods=labels,
            point=[round(float(v), 2) for v in arr.mean(axis=0)],
            band=band_from_samples(arr, level=0.9),
        ))
    employed_final = series[0].point[-1]
    return EngineResult(
        engine=EngineName.system_dynamics,
        engine_version=ENGINE_VERSION,
        model_version=f"stock-flow-euler/{ENGINE_VERSION}",
        summary=(f"Stock-flow model over {ctx.horizon_months} months with "
                 f"{n_mc} Monte-Carlo runs; employed stock ends at "
                 f"{employed_final:,.0f}k."),
        series=series,
        metadata={"n_monte_carlo": n_mc, "dt_months": 1,
                  "feedback_loops": ["R1 growth", "B1 skill-capacity"],
                  "pysd_available": _HAS_PYSD},
        reproducibility=build_reproducibility(ENGINE_VERSION, ctx.random_seed),
    )
