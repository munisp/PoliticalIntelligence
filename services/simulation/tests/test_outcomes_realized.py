"""G2: realized-outcome store — causal real-panel path, backtest realized
actuals, and the /v1/outcomes handoff endpoints. Determinism preserved."""
from __future__ import annotations

import asyncio

import numpy as np
import pytest
from httpx import ASGITransport, AsyncClient

from app.backtest import BacktestRequest, run_backtest
from app.engines import causal
from app.main import app
from app.outcomes import OutcomeStore
from tests.test_engines import make_ctx


# ---------------------------------------------------------------------------
# Causal engine: realized panel vs synthetic fallback
# ---------------------------------------------------------------------------
def _unit_panel(n: int = 120) -> list[dict]:
    """Deterministic unit-record panel with a known treatment effect (+2.0)."""
    rng = np.random.default_rng(7)
    income = rng.normal(50.0, 5.0, size=n)
    treated = (np.arange(n) % 2).astype(float)
    noise = rng.normal(0.0, 0.5, size=n)
    outcome = 10.0 + 0.1 * income + 2.0 * treated + noise
    return [
        {"treated": float(treated[i]), "outcome": float(outcome[i]),
         "income": float(income[i])}
        for i in range(n)
    ]


def _aggregated_panel() -> list[dict]:
    """Deterministic quarterly observations with a +3.0 level shift at the
    median split (deterministic treatment assignment)."""
    periods = ["2023-03", "2023-06", "2023-09", "2023-12",
               "2024-03", "2024-06", "2024-09", "2024-12"]
    values = [70.0, 70.2, 70.1, 70.3, 73.2, 73.0, 73.4, 73.1]
    return [{"period": p, "indicator": "EMPLOYMENT_TOTAL", "value": v}
            for p, v in zip(periods, values)]


def test_causal_realized_unit_panel_recovers_effect():
    ctx = make_ctx("causal")
    ctx.panel = _unit_panel()
    result = causal.run(ctx)
    assert result.metadata["data_mode"] == "realized"
    est = result.estimates[0]
    assert est.estimate == pytest.approx(2.0, abs=0.1)
    assert est.ci_lower < 2.0 < est.ci_upper


def test_causal_realized_aggregated_observations():
    ctx = make_ctx("causal")
    ctx.panel = _aggregated_panel()
    result = causal.run(ctx)
    assert result.metadata["data_mode"] == "realized"
    assert "EMPLOYMENT_TOTAL" in result.metadata["panel"]
    # Level shift ≈ +3.0 recovered by the post-split treatment dummy.
    assert result.estimates[0].estimate == pytest.approx(3.0, abs=0.2)


def test_causal_synthetic_fallback_unchanged():
    """No panel -> synthetic behavior, data_mode recorded, determinism kept."""
    a = causal.run(make_ctx("causal"))
    b = causal.run(make_ctx("causal"))
    assert a.metadata["data_mode"] == "synthetic"
    assert a.model_dump(mode="json") == b.model_dump(mode="json")


def test_causal_realized_path_is_deterministic():
    ctx1, ctx2 = make_ctx("causal"), make_ctx("causal")
    ctx1.panel = ctx2.panel = _unit_panel()
    assert (causal.run(ctx1).model_dump(mode="json")
            == causal.run(ctx2).model_dump(mode="json"))


# ---------------------------------------------------------------------------
# Backtest: realized actuals vs seeded fallback
# ---------------------------------------------------------------------------
def _monthly_actuals(n: int = 24) -> list[dict]:
    periods, values = [], []
    y, m = 2024, 1
    for i in range(n):
        periods.append(f"{y}-{m:02d}")
        values.append(100.0 + 0.5 * i)
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return [{"period": p, "value": v} for p, v in zip(periods, values)]


def test_backtest_with_explicit_realized_actuals():
    req = BacktestRequest(jurisdiction_id="jur:ng-kd", metric="employment",
                          engines=["forecast"], cutoffs=[18, 21],
                          actuals=_monthly_actuals())
    report = run_backtest(req)
    assert report.actuals_source == "realized"
    assert report.history_periods[0] == "2024-01"
    assert len(report.history_periods) == 24
    # Linear actuals -> Holt hindcast should have near-zero error.
    assert report.engines[0].rmse_mean < 1.0


def test_backtest_with_pushed_store_actuals():
    store = OutcomeStore()
    store.push("jur:ng-kd", "EMPLOYMENT_TOTAL", _monthly_actuals())
    req = BacktestRequest(jurisdiction_id="jur:ng-kd", metric="employment",
                          engines=["forecast"], cutoffs=[18, 21])
    report = run_backtest(req, outcomes=store)
    assert report.actuals_source == "realized"


def test_backtest_seeded_fallback_unchanged():
    """No actuals anywhere -> seeded series, deterministic report hash."""
    req = BacktestRequest(jurisdiction_id="jur:ng-kd", metric="employment",
                          engines=["forecast"], cutoffs=[18, 21])
    r1 = run_backtest(req)
    r2 = run_backtest(req, outcomes=OutcomeStore())  # empty store
    assert r1.actuals_source == r2.actuals_source == "seeded"
    assert r1.report_hash == r2.report_hash


# ---------------------------------------------------------------------------
# /v1/outcomes handoff endpoints
# ---------------------------------------------------------------------------
def test_outcomes_push_get_and_backtest_endpoint(tmp_path):
    from app.storage import ArtifactStore
    from app.worker import RunManager
    app.state.runs = RunManager(store=ArtifactStore(root=tmp_path))

    async def go():
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            push = await c.post("/v1/outcomes", json={
                "jurisdiction_id": "jur:ng-kd",
                "indicator_code": "EMPLOYMENT_TOTAL",
                "observations": _monthly_actuals(),
            })
            assert push.status_code == 201
            assert push.json()["data"]["applied"] == 24

            get = await c.get("/v1/outcomes/jur:ng-kd?indicator=EMPLOYMENT_TOTAL")
            body = get.json()["data"]
            assert body["data_available"] is True
            assert body["periods"][0] == "2024-01"
            assert len(body["values"]) == 24

            listing = await c.get("/v1/outcomes/jur:ng-kd")
            assert "EMPLOYMENT_TOTAL" in listing.json()["data"]["indicators"]

            bt = await c.post("/v1/backtests", json={
                "jurisdiction_id": "jur:ng-kd", "metric": "employment",
                "engines": ["forecast"], "cutoffs": [18, 21]})
            assert bt.status_code == 200
            assert bt.json()["data"]["actuals_source"] == "realized"

    asyncio.run(go())


def test_outcomes_get_empty_when_nothing_pushed(tmp_path):
    from app.storage import ArtifactStore
    from app.worker import RunManager
    app.state.runs = RunManager(store=ArtifactStore(root=tmp_path))

    async def go():
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:
            get = await c.get("/v1/outcomes/jur:ng-kd?indicator=FIRM_COUNT")
            body = get.json()["data"]
            assert body["data_available"] is False
            assert body["periods"] == [] and body["values"] == []

    asyncio.run(go())
