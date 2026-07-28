"""Engine-level backtesting & calibration framework (SIM-5, spec section 22-23).

Closes the calibration gap: every simulation engine is backtested against
historical outcomes via *walk-forward validation* over multiple cutoff
windows. For each window the engine is refit/hindcast using ONLY pre-cutoff
data and scored against the realized post-cutoff segment:

  * MAPE (mean absolute percentage error)
  * RMSE
  * band coverage — % of actuals inside the engine's 80% uncertainty band
  * skill score — 1 - RMSE/RMSE_naive vs a naive persistence baseline

The aggregated per-engine table is persisted as a calibration-report
artifact per jurisdiction/metric (content-addressed via a deterministic
report hash) and can drive ``recalibrate_from_backtest`` which nudges the
digital twin's behavioral priors from backtest residuals.

Everything is deterministic: all stochastic components derive from
``random_seed`` via process-independent stable hashing.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Callable

import numpy as np
from pydantic import BaseModel, Field

from app.data import seed as seed_data
from app.engines.forecast import _holt_fit
from app.logging_setup import get_logger

log = get_logger("backtest")

BACKTEST_VERSION = "1.0.0"
ALL_ENGINES = ("forecast", "causal", "microsim", "abm",
               "system_dynamics", "optimization")
BAND_LEVEL = 0.8
# z for an 80% two-sided normal interval
Z80 = 1.2815515655446004


def _stable_seed(*parts: object) -> int:
    """Process-independent seed derivation (PYTHONHASHSEED-safe)."""
    digest = hashlib.sha256("::".join(str(p) for p in parts).encode()).hexdigest()
    return int(digest[:8], 16)


# ---------------------------------------------------------------------------
# Metrics (pure functions — unit-tested on synthetic data with known values)
# ---------------------------------------------------------------------------
def mape(actual: np.ndarray, predicted: np.ndarray) -> float:
    """Mean absolute percentage error (%); zeros excluded from the mean."""
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    mask = actual != 0
    if not mask.any():
        return 0.0
    return float(np.mean(np.abs((actual[mask] - predicted[mask])
                                / actual[mask])) * 100.0)


def rmse(actual: np.ndarray, predicted: np.ndarray) -> float:
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    return float(np.sqrt(np.mean((actual - predicted) ** 2)))


def band_coverage(actual: np.ndarray, lower: np.ndarray, upper: np.ndarray) -> float:
    """Share of actuals inside [lower, upper] (0..1)."""
    actual = np.asarray(actual, dtype=float)
    inside = (actual >= np.asarray(lower, dtype=float)) & \
             (actual <= np.asarray(upper, dtype=float))
    return float(np.mean(inside)) if len(actual) else 0.0


def skill_score(model_rmse: float, baseline_rmse: float) -> float:
    """1 - RMSE_model/RMSE_naive; 1 = perfect, 0 = naive parity, <0 = worse."""
    if baseline_rmse <= 0:
        return 1.0 if model_rmse <= 0 else 0.0
    return 1.0 - model_rmse / baseline_rmse


def naive_persistence(train: np.ndarray, horizon: int) -> np.ndarray:
    """Naive baseline: hold the last observed value constant."""
    return np.full(horizon, float(train[-1]))


# ---------------------------------------------------------------------------
# Per-engine hindcast adapters
#
# Each adapter mirrors its engine's documented dynamics but is driven solely
# by the pre-cutoff training window, so the walk-forward evaluation is a
# genuine out-of-sample test. Adapters return (point, lower80, upper80).
# ---------------------------------------------------------------------------
def _trend_slope(y: np.ndarray) -> float:
    """OLS slope (per month) of the training window."""
    t = np.arange(len(y), dtype=float)
    t = t - t.mean()
    denom = float(t @ t) or 1.0
    return float(t @ (y - y.mean()) / denom)


def _resid_sd(y: np.ndarray) -> float:
    slope = _trend_slope(y)
    fitted = y.mean() + slope * (np.arange(len(y)) - (len(y) - 1) / 2.0)
    return float(np.std(y - fitted)) or float(np.std(y)) or 1.0


def _band(point: np.ndarray, spread: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    return point - Z80 * spread, point + Z80 * spread


def _hindcast_forecast(train: np.ndarray, h: int,
                       rng: np.random.Generator) -> tuple[np.ndarray, ...]:
    """Forecast engine: refit Holt linear trend on the window, residual
    bootstrap 80% band (same machinery as engines/forecast.run)."""
    fitted, level, trend = _holt_fit(np.asarray(train, dtype=float))
    residuals = train - fitted
    steps = np.arange(1, h + 1)
    point = level + trend * steps
    idx = rng.integers(0, len(residuals), size=(200, h))
    samples = point[None, :] + residuals[idx] * np.sqrt(steps)[None, :]
    alpha = (1 - BAND_LEVEL) / 2
    lower = np.quantile(samples, alpha, axis=0)
    upper = np.quantile(samples, 1 - alpha, axis=0)
    return point, lower, upper


def _hindcast_causal(train: np.ndarray, h: int,
                     rng: np.random.Generator) -> tuple[np.ndarray, ...]:
    """Causal engine: level + drift estimate (difference-of-means between
    the recent and early halves of the window), projected with an
    OLS-style residual band."""
    half = max(len(train) // 2, 1)
    drift = float(np.mean(train[-half:]) - np.mean(train[:half])) / half
    slope = 0.5 * _trend_slope(train) + 0.5 * drift
    sd = _resid_sd(train)
    point = train[-1] + slope * np.arange(1, h + 1)
    return (point, *_band(point, sd * np.sqrt(np.arange(1, h + 1))))


def _hindcast_microsim(train: np.ndarray, h: int,
                       rng: np.random.Generator) -> tuple[np.ndarray, ...]:
    """Microsim engine: stock ramps along the window trend with a saturating
    formalization curve; band from bootstrap replication jitter."""
    slope = _trend_slope(train)
    sd = _resid_sd(train)
    steps = np.arange(1, h + 1)
    sat = 1.0 - np.exp(-steps / max(h / 2.0, 1.0))
    base = train[-1] + slope * steps * sat
    reps = base[None, :] * (1.0 + rng.normal(0.0, 0.02, size=(100, h))) \
        + rng.normal(0.0, sd * 0.5, size=(100, h))
    alpha = (1 - BAND_LEVEL) / 2
    return (base, np.quantile(reps, alpha, axis=0),
            np.quantile(reps, 1 - alpha, axis=0))


def _hindcast_abm(train: np.ndarray, h: int,
                  rng: np.random.Generator) -> tuple[np.ndarray, ...]:
    """ABM engine: aggregate hire/exit flow — hires proportional to the
    window's mean monthly gain, exits proportional to the stock; band from
    seeded replications (mirrors engines/abm replications)."""
    gains = np.diff(train)
    mean_gain = float(np.mean(gains)) if len(gains) else 0.0
    exit_rate = 0.01
    sd = _resid_sd(train)

    def path(noise: np.ndarray) -> np.ndarray:
        stock = float(train[-1])
        out = np.empty(h)
        for m in range(h):
            hires = mean_gain * (1.0 + 0.15 * noise[m])
            stock = max(0.0, stock + hires - exit_rate * stock)
            out[m] = stock
        return out

    reps = np.stack([path(rng.normal(0, 1, h)) for _ in range(100)])
    point = reps.mean(axis=0)
    alpha = (1 - BAND_LEVEL) / 2
    lower = np.minimum(np.quantile(reps, alpha, axis=0),
                       point - Z80 * sd * 0.25)
    upper = np.maximum(np.quantile(reps, 1 - alpha, axis=0),
                       point + Z80 * sd * 0.25)
    return point, lower, upper


def _hindcast_system_dynamics(train: np.ndarray, h: int,
                              rng: np.random.Generator) -> tuple[np.ndarray, ...]:
    """System-dynamics engine: one-stock Euler integration with the net
    growth rate implied by the window (stock-flow reduced form)."""
    eps = 1e-9
    net_rate = float((train[-1] - train[0]) / max(train[0], eps)) / max(len(train) - 1, 1)
    sd = _resid_sd(train)

    def path(rate: float) -> np.ndarray:
        stock = float(train[-1])
        out = np.empty(h)
        for m in range(h):
            stock = max(0.0, stock * (1.0 + rate))
            out[m] = stock
        return out

    rates = net_rate * rng.uniform(0.8, 1.2, size=60)
    reps = np.stack([path(float(r)) for r in rates])
    point = path(net_rate)
    alpha = (1 - BAND_LEVEL) / 2
    lower = np.minimum(np.quantile(reps, alpha, axis=0), point - Z80 * sd * 0.5)
    upper = np.maximum(np.quantile(reps, 1 - alpha, axis=0), point + Z80 * sd * 0.5)
    return point, lower, upper


def _hindcast_optimization(train: np.ndarray, h: int,
                           rng: np.random.Generator) -> tuple[np.ndarray, ...]:
    """Optimization engine: deployment ramp toward the trend-implied target
    (portfolio spend-down curve), band from allocation jitter."""
    slope = _trend_slope(train)
    sd = _resid_sd(train)
    target = float(train[-1] + slope * h)
    steps = np.arange(1, h + 1)
    point = train[-1] + (target - train[-1]) * (steps / h)
    reps = point[None, :] * (1.0 + rng.normal(0.0, 0.015, size=(60, h))) \
        + rng.normal(0.0, sd * 0.4, size=(60, h))
    alpha = (1 - BAND_LEVEL) / 2
    return (point, np.quantile(reps, alpha, axis=0),
            np.quantile(reps, 1 - alpha, axis=0))


HINDCAST: dict[str, Callable[[np.ndarray, int, np.random.Generator],
                             tuple[np.ndarray, ...]]] = {
    "forecast": _hindcast_forecast,
    "causal": _hindcast_causal,
    "microsim": _hindcast_microsim,
    "abm": _hindcast_abm,
    "system_dynamics": _hindcast_system_dynamics,
    "optimization": _hindcast_optimization,
}

# Engine -> twin behavioral prior the engine's residuals inform.
ENGINE_PRIOR_MAP = {
    "forecast": "hiring_elasticity",
    "system_dynamics": "hiring_elasticity",
    "microsim": "subsidy_takeup",
    "abm": "firm_birth_rate",
    "causal": "hiring_elasticity",
    "optimization": "subsidy_takeup",
}

PRIOR_BOUNDS = {
    "hiring_elasticity": (0.05, 1.5),
    "subsidy_takeup": (0.05, 0.95),
    "firm_birth_rate": (0.005, 0.20),
}


# ---------------------------------------------------------------------------
# Report models
# ---------------------------------------------------------------------------
class WindowMetrics(BaseModel):
    cutoff_index: int
    train_periods: list[str]
    test_periods: list[str]
    mape: float
    rmse: float
    coverage_80: float
    skill_vs_naive: float
    mean_relative_bias: float


class EngineCalibration(BaseModel):
    engine: str
    windows: list[WindowMetrics]
    mape_mean: float
    rmse_mean: float
    coverage_80_mean: float
    skill_vs_naive_mean: float
    calibrated_prior: str | None = None


class CalibrationReport(BaseModel):
    report_version: str = BACKTEST_VERSION
    jurisdiction_id: str
    metric: str
    band_level: float = BAND_LEVEL
    random_seed: int
    cutoffs: list[int]
    history_periods: list[str]
    engines: list[EngineCalibration]
    report_hash: str = ""
    artifact: dict[str, Any] | None = None
    recalibration: dict[str, Any] | None = None


class BacktestRequest(BaseModel):
    jurisdiction_id: str = "jur:ng-kd"
    metric: str = "employment"
    engines: list[str] = Field(default_factory=lambda: list(ALL_ENGINES))
    cutoffs: list[int] | None = None  # default: walk-forward grid
    random_seed: int = 42
    recalibrate: bool = False


# ---------------------------------------------------------------------------
# Core walk-forward evaluation
# ---------------------------------------------------------------------------
def default_cutoffs(n_history: int, min_train: int = 18,
                    max_windows: int = 4) -> list[int]:
    """Walk-forward cutoff grid: expanding windows leaving >=3 test months."""
    last = n_history - 3
    if last < min_train:
        min_train = max(3, n_history - 9)
    cuts = list(range(min_train, last + 1))
    if len(cuts) > max_windows:
        step = (len(cuts) - 1) / (max_windows - 1)
        cuts = sorted({cuts[round(i * step)] for i in range(max_windows)})
    return cuts


def _window_metrics(train: np.ndarray, test: np.ndarray,
                    point: np.ndarray, lower: np.ndarray,
                    upper: np.ndarray) -> WindowMetrics:
    naive = naive_persistence(train, len(test))
    bias = float(np.mean((point - test) / np.where(test != 0, test, 1.0)))
    return WindowMetrics(
        cutoff_index=-1, train_periods=[], test_periods=[],
        mape=round(mape(test, point), 4),
        rmse=round(rmse(test, point), 4),
        coverage_80=round(band_coverage(test, lower, upper), 4),
        skill_vs_naive=round(skill_score(rmse(test, point),
                                         rmse(test, naive)), 4),
        mean_relative_bias=round(bias, 6),
    )


def run_backtest(req: BacktestRequest) -> CalibrationReport:
    """Walk-forward backtest of all requested engines for one metric."""
    periods, history = seed_data.baseline_series(req.jurisdiction_id, req.metric)
    history = np.asarray(history, dtype=float)
    n = len(history)
    cutoffs = req.cutoffs or default_cutoffs(n)
    for c in cutoffs:
        if not (3 <= c <= n - 1):
            from app.errors import ValidationError
            raise ValidationError(
                f"cutoff {c} out of range for history of length {n}",
                details={"history_length": n})

    engine_rows: list[EngineCalibration] = []
    for engine in req.engines:
        hindcast = HINDCAST.get(engine)
        if hindcast is None:
            from app.errors import ValidationError
            raise ValidationError(f"Unknown engine '{engine}'",
                                  details={"known": sorted(HINDCAST)})
        windows: list[WindowMetrics] = []
        for cutoff in cutoffs:
            train, test = history[:cutoff], history[cutoff:]
            rng = np.random.default_rng(_stable_seed(
                "backtest", BACKTEST_VERSION, req.jurisdiction_id,
                req.metric, engine, cutoff, req.random_seed))
            point, lower, upper = hindcast(train, len(test), rng)
            wm = _window_metrics(train, test, point, lower, upper)
            wm.cutoff_index = cutoff
            wm.train_periods = periods[:cutoff]
            wm.test_periods = periods[cutoff:]
            windows.append(wm)
        f = lambda k: round(float(np.mean([getattr(w, k) for w in windows])), 4)
        engine_rows.append(EngineCalibration(
            engine=engine, windows=windows,
            mape_mean=f("mape"), rmse_mean=f("rmse"),
            coverage_80_mean=f("coverage_80"),
            skill_vs_naive_mean=f("skill_vs_naive"),
            calibrated_prior=ENGINE_PRIOR_MAP.get(engine),
        ))

    report = CalibrationReport(
        jurisdiction_id=req.jurisdiction_id, metric=req.metric,
        random_seed=req.random_seed, cutoffs=list(cutoffs),
        history_periods=list(periods), engines=engine_rows,
    )
    report.report_hash = report_hash(report)
    log.info("backtest complete",
             extra={"jurisdiction_id": req.jurisdiction_id,
                    "metric": req.metric, "engines": len(engine_rows),
                    "windows": len(cutoffs), "hash": report.report_hash})
    return report


def report_hash(report: CalibrationReport) -> str:
    """Content hash over quantitative report content (reproducibility)."""
    dump = report.model_dump(mode="json")
    for k in ("report_hash", "artifact", "recalibration"):
        dump.pop(k, None)
    payload = json.dumps(dump, sort_keys=True, default=str)
    return hashlib.sha256(payload.encode()).hexdigest()


def persist_report(report: CalibrationReport, store) -> dict[str, Any]:
    """Persist the calibration report artifact per jurisdiction/metric."""
    key = (f"backtests/{report.jurisdiction_id}/"
           f"{report.metric}-calibration-{report.report_hash[:12]}.json")
    art = store.put_json(key, report.model_dump(mode="json"))
    report.artifact = art
    return art


# ---------------------------------------------------------------------------
# Recalibration hook: adjust twin priors from backtest residuals
# ---------------------------------------------------------------------------
def recalibration_adjustments(report: CalibrationReport) -> dict[str, float]:
    """Map per-engine mean relative bias onto behavioral prior multipliers.

    A positive bias (engine overshoots actuals) shrinks the associated
    behavioral prior; negative bias expands it. Adjustments are damped
    (factor 0.5) and clamped to ±20% per backtest cycle.
    """
    acc: dict[str, list[float]] = {}
    for row in report.engines:
        prior = row.calibrated_prior
        if prior is None:
            continue
        bias = float(np.mean([w.mean_relative_bias for w in row.windows]))
        acc.setdefault(prior, []).append(bias)
    adjustments: dict[str, float] = {}
    for prior, biases in acc.items():
        mean_bias = float(np.mean(biases))
        factor = 1.0 - 0.5 * float(np.clip(mean_bias, -0.4, 0.4))
        adjustments[prior] = round(float(np.clip(factor, 0.8, 1.2)), 6)
    return adjustments


def recalibrate_from_backtest(report: CalibrationReport, twins) -> dict[str, Any]:
    """Apply backtest-derived prior adjustments to the digital twin and
    persist the recalibrated twin state (adaptive layer records the event)."""
    adjustments = recalibration_adjustments(report)
    twin = twins.recalibrate(
        report.jurisdiction_id,
        adjustments=adjustments,
        bounds=PRIOR_BOUNDS,
        note=(f"backtest {report.report_hash[:12]} metric={report.metric} "
              f"priors={adjustments}"),
    )
    report.recalibration = {
        "twin_state_version": twin.version,
        "adjustments": adjustments,
        "behavioral": twin.behavioral.model_dump(mode="json"),
    }
    return report.recalibration
