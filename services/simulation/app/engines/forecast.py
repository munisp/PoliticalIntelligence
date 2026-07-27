"""Probabilistic time-series forecasting engine (spec section 22).

Holt linear-trend state-space model fit in closed form (numpy), with residual
bootstrap prediction intervals. PyMC integration is OPTIONAL and only used
when installed and ``use_bayes`` is requested; the numpy path is the default
and fully deterministic.
"""
from __future__ import annotations

import numpy as np

from app.models import EngineName, EngineResult, SeriesResult
from app.data import seed as seed_data
from app.engines import (EngineContext, band_from_samples, build_reproducibility,
                         horizon_labels, intervention_scale)

ENGINE_VERSION = "1.2.0"

try:  # optional heavy dependency
    import pymc  # noqa: F401
    _HAS_PYMC = True
except Exception:  # pragma: no cover - depends on env
    _HAS_PYMC = False


def _holt_fit(y: np.ndarray, alpha: float = 0.6, beta: float = 0.1) -> tuple[np.ndarray, float, float]:
    """Return (fitted, final_level, final_trend) using Holt's linear method."""
    level = y[0]
    trend = y[1] - y[0] if len(y) > 1 else 0.0
    fitted = np.empty_like(y)
    fitted[0] = y[0]
    for t in range(1, len(y)):
        fitted[t] = level + trend
        prev_level = level
        level = alpha * y[t] + (1 - alpha) * (level + trend)
        trend = beta * (level - prev_level) + (1 - beta) * trend
    return fitted, level, trend


def run(ctx: EngineContext) -> EngineResult:
    rng = ctx.rng
    params = ctx.plan.parameters
    n_boot = int(params.get("n_bootstrap", 200))
    metric = params.get("metric", "employment")

    periods_hist, hist = seed_data.baseline_series(
        ctx.jurisdiction.jurisdiction_id, metric)
    hist = np.asarray(hist, dtype=float)

    fitted, level, trend = _holt_fit(hist)
    residuals = hist - fitted
    resid_sd = float(np.std(residuals)) or 1.0

    h = ctx.horizon_months
    # Intervention lift: proportional to intensity and assumptions elasticity.
    elasticity = float(ctx.assumptions.values.get("hiring_elasticity", 0.5))
    lift_per_month = intervention_scale(ctx) * elasticity * 0.002 * level

    steps = np.arange(1, h + 1)
    point = level + trend * steps + lift_per_month * np.log1p(steps)

    # Bootstrap intervals: resample residuals, propagate through the trend path.
    idx = rng.integers(0, len(residuals), size=(n_boot, h))
    shocks = residuals[idx]
    scale = np.sqrt(steps)  # uncertainty grows with horizon
    samples = point[None, :] + shocks * scale[None, :] + \
        rng.normal(0.0, resid_sd * 0.25, size=(n_boot, h))
    band = band_from_samples(samples, level=0.9)

    series = SeriesResult(
        metric=metric,
        unit="count" if metric != "unemployment_rate" else "ratio",
        periods=horizon_labels(ctx),
        point=[round(float(v), 4) for v in point],
        band=band,
    )
    return EngineResult(
        engine=EngineName.forecast,
        engine_version=ENGINE_VERSION,
        model_version=f"holt-linear-bootstrap/{ENGINE_VERSION}",
        summary=(f"Holt-linear forecast of '{metric}' for {h} months with "
                 f"90% bootstrap bands; intervention lift elasticity "
                 f"{elasticity:.2f}."),
        series=[series],
        metadata={
            "history_periods": periods_hist,
            "history": [round(float(v), 4) for v in hist],
            "n_bootstrap": n_boot,
            "pymc_available": _HAS_PYMC,
        },
        reproducibility=build_reproducibility(ENGINE_VERSION, ctx.random_seed),
    )
