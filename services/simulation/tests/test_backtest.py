"""SIM-5: engine-level backtesting & calibration tests.

Covers: walk-forward window correctness (no train/test leakage), metric
correctness on synthetic data with known properties, band coverage
correctness, determinism/reproducibility of the report hash, artifact
persistence, the twin recalibration hook, and the HTTP surface.
"""
from __future__ import annotations

import asyncio

import numpy as np
import pytest
from httpx import ASGITransport, AsyncClient

from app.backtest import (ALL_ENGINES, BacktestRequest, band_coverage,
                          default_cutoffs, mape, naive_persistence,
                          recalibrate_from_backtest, recalibration_adjustments,
                          report_hash, rmse, run_backtest, skill_score,
                          persist_report, _window_metrics)
from app.main import app
from app.storage import ArtifactStore
from app.twin import TwinRegistry


# ---------------------------------------------------------------------------
# Metric correctness on synthetic data with known properties
# ---------------------------------------------------------------------------
def test_mape_known_value():
    actual = np.array([100.0, 200.0, 400.0])
    pred = np.array([110.0, 180.0, 400.0])  # errors: 10%, 10%, 0%
    assert mape(actual, pred) == pytest.approx((10 + 10 + 0) / 3, abs=1e-6)


def test_rmse_known_value():
    actual = np.array([1.0, 2.0, 3.0])
    pred = np.array([1.0, 4.0, 3.0])  # squared errors 0, 4, 0
    assert rmse(actual, pred) == pytest.approx(np.sqrt(4 / 3), abs=1e-9)


def test_coverage_all_inside_and_outside():
    actual = np.array([10.0, 20.0, 30.0, 40.0])
    lower = actual - 5.0
    upper = actual + 5.0
    assert band_coverage(actual, lower, upper) == 1.0
    # shift band entirely below actuals → zero coverage
    assert band_coverage(actual, lower - 10.0, upper - 10.0) == 0.0


def test_coverage_partial_known_fraction():
    actual = np.arange(10.0)  # 0..9
    lower = np.full(10, 2.0)
    upper = np.full(10, 6.0)  # covers 2,3,4,5,6 → 5 of 10
    assert band_coverage(actual, lower, upper) == pytest.approx(0.5)


def test_skill_score_known_values():
    assert skill_score(0.0, 1.0) == 1.0          # perfect
    assert skill_score(1.0, 1.0) == 0.0          # naive parity
    assert skill_score(2.0, 1.0) == -1.0         # worse than naive
    assert skill_score(0.5, 2.0) == pytest.approx(0.75)


def test_naive_persistence_holds_last_value():
    train = np.array([3.0, 5.0, 7.0])
    assert np.allclose(naive_persistence(train, 4), [7.0] * 4)


# ---------------------------------------------------------------------------
# Walk-forward correctness
# ---------------------------------------------------------------------------
def test_default_cutoffs_multiple_windows():
    cuts = default_cutoffs(36)
    assert len(cuts) >= 3                      # multiple cutoff windows
    assert all(3 <= c <= 33 for c in cuts)     # >=3 test months each
    assert cuts == sorted(set(cuts))           # strictly increasing


def test_walk_forward_no_leakage():
    """Every window's test segment starts strictly after its train segment."""
    req = BacktestRequest(jurisdiction_id="jur:ng-kd", engines=["forecast"])
    report = run_backtest(req)
    for row in report.engines:
        for w in row.windows:
            assert w.cutoff_index == len(w.train_periods)
            assert w.train_periods[-1] < w.test_periods[0]
            assert w.train_periods + w.test_periods == report.history_periods
    # multiple windows were evaluated
    assert len(report.engines[0].windows) >= 3


def test_all_six_engines_calibrated():
    report = run_backtest(BacktestRequest(jurisdiction_id="jur:ng-kd"))
    assert {r.engine for r in report.engines} == set(ALL_ENGINES)
    for row in report.engines:
        assert row.mape_mean >= 0
        assert row.rmse_mean >= 0
        assert 0.0 <= row.coverage_80_mean <= 1.0
        assert row.skill_vs_naive_mean <= 1.0
        assert row.calibrated_prior is not None


def test_coverage_metric_end_to_end_bounds():
    """Engines with growing bands must achieve non-trivial 80%-band coverage
    on the (smooth, low-noise) seeded history; and the metric must differ
    from a degenerate zero-width band."""
    report = run_backtest(BacktestRequest(
        jurisdiction_id="jur:ng-kd", engines=["forecast"]))
    row = report.engines[0]
    assert row.coverage_80_mean > 0.0
    # Degenerate band (point == lower == upper) can only cover exact hits.
    w = row.windows[0]
    from app.data import seed as seed_data
    _, hist = seed_data.baseline_series("jur:ng-kd", "employment")
    test = hist[w.cutoff_index:]
    deg = band_coverage(test, test - 1.0, test - 1.0)
    assert deg == 0.0


# ---------------------------------------------------------------------------
# Determinism / reproducibility
# ---------------------------------------------------------------------------
def test_report_deterministic_same_seed():
    req = BacktestRequest(jurisdiction_id="jur:ng-la")
    r1 = run_backtest(req)
    r2 = run_backtest(req)
    assert r1.report_hash == r2.report_hash
    assert r1.model_dump(mode="json") == r2.model_dump(mode="json")


def test_report_hash_changes_with_seed_or_jurisdiction():
    base = run_backtest(BacktestRequest(jurisdiction_id="jur:ng-la"))
    other_seed = run_backtest(BacktestRequest(jurisdiction_id="jur:ng-la",
                                              random_seed=7))
    other_jur = run_backtest(BacktestRequest(jurisdiction_id="jur:ng-kd"))
    assert base.report_hash == report_hash(base)  # hash is stable & pure
    assert base.report_hash != other_seed.report_hash
    assert base.report_hash != other_jur.report_hash


def test_invalid_cutoff_rejected():
    with pytest.raises(Exception):
        run_backtest(BacktestRequest(jurisdiction_id="jur:ng-kd",
                                     cutoffs=[100]))
    with pytest.raises(Exception):
        run_backtest(BacktestRequest(jurisdiction_id="jur:ng-kd",
                                     engines=["nonsense"]))


# ---------------------------------------------------------------------------
# Artifact persistence + recalibration hook
# ---------------------------------------------------------------------------
def test_report_artifact_persisted(tmp_path):
    store = ArtifactStore(root=tmp_path)
    report = run_backtest(BacktestRequest(jurisdiction_id="jur:ng-kd",
                                          engines=["forecast"]))
    art = persist_report(report, store)
    assert art["size_bytes"] > 0
    loaded = store.get_json(
        f"backtests/jur:ng-kd/employment-calibration-"
        f"{report.report_hash[:12]}.json")
    assert loaded is not None
    assert loaded["report_hash"] == report.report_hash
    assert loaded["engines"][0]["engine"] == "forecast"


def test_recalibration_adjustments_direction():
    """Positive bias (overshoot) → shrink factor < 1; negative → > 1."""
    req = BacktestRequest(jurisdiction_id="jur:ng-kd", engines=["forecast"])
    report = run_backtest(req)
    adj = recalibration_adjustments(report)
    assert set(adj) <= {"hiring_elasticity", "subsidy_takeup",
                        "firm_birth_rate"}
    for factor in adj.values():
        assert 0.8 <= factor <= 1.2
    # synthetic bias check: engine overshoot shrinks the prior
    w = _window_metrics(np.array([100.0, 100.0]), np.array([100.0]),
                        np.array([140.0]), np.array([130.0]), np.array([150.0]))
    assert w.mean_relative_bias > 0


def test_recalibrate_from_backtest_updates_twin(tmp_path):
    store = ArtifactStore(root=tmp_path)
    twins = TwinRegistry(store)
    twin = twins.get_or_create("jur:ng-kd")
    prior_elasticity = twin.behavioral.hiring_elasticity
    v0 = twin.version
    report = run_backtest(BacktestRequest(jurisdiction_id="jur:ng-kd",
                                          engines=["forecast", "microsim"]))
    rec = recalibrate_from_backtest(report, twins)
    assert twin.version == v0 + 1
    assert rec["twin_state_version"] == twin.version
    # priors actually moved (non-degenerate residuals) and persisted
    assert rec["adjustments"]
    assert twin.behavioral.hiring_elasticity != prior_elasticity or \
        rec["adjustments"].get("hiring_elasticity") == 1.0
    saved = store.get_json(f"twins/jur:ng-kd/twin-state-v{twin.version}.json")
    assert saved is not None
    assert saved["version"] == twin.version
    assert any("recalibrate" in n for n in saved["adaptive"]["notes"])


# ---------------------------------------------------------------------------
# HTTP surface
# ---------------------------------------------------------------------------
def _make_client(tmp_path):
    from app.worker import RunManager
    manager = RunManager(store=ArtifactStore(root=tmp_path))
    app.state.runs = manager
    return manager, AsyncClient(transport=ASGITransport(app=app),
                                base_url="http://test")


def test_backtests_endpoint_returns_envelope(tmp_path):
    async def go():
        manager, client = _make_client(tmp_path)
        try:
            return await client.post("/v1/backtests", json={
                "jurisdiction_id": "jur:ng-kd",
                "metric": "employment",
                "recalibrate": True,
            })
        finally:
            await client.aclose()
    resp = asyncio.run(go())
    assert resp.status_code == 200
    body = resp.json()
    data = body["data"]
    assert body["meta"]["api_version"] == "v1"
    assert len(data["engines"]) == 6
    assert len(data["cutoffs"]) >= 3
    assert data["report_hash"]
    assert data["artifact"]["name"].endswith(".json")
    assert data["recalibration"]["twin_state_version"] >= 1
    first = data["engines"][0]
    for key in ("mape_mean", "rmse_mean", "coverage_80_mean",
                "skill_vs_naive_mean", "windows"):
        assert key in first


def test_backtests_endpoint_unknown_jurisdiction_4xx(tmp_path):
    async def go():
        _, client = _make_client(tmp_path)
        try:
            return await client.post("/v1/backtests", json={
                "jurisdiction_id": "jur:nowhere"})
        finally:
            await client.aclose()
    resp = asyncio.run(go())
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"
