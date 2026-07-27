"""Reproducibility (spec section 10): same seed -> same results across runs."""
from __future__ import annotations

import asyncio
import time

from httpx import ASGITransport, AsyncClient

from app.main import app
from app.storage import ArtifactStore
from app.worker import RunManager, results_digest

SCENARIO = {
    "jurisdiction_id": "jur:ng-la",
    "assumptions_set": "asm:sme:base",
    "interventions": [{
        "intervention_id": "iv:la-1", "name": "Lagos subsidy", "sector": "sme",
        "kind": "wage_subsidy", "budget_ngn_m": 1000.0,
        "target_population": 50000, "intensity": 0.5, "duration_months": 12,
    }],
    "model_plan": [
        {"engine": "forecast", "horizon_months": 12, "parameters": {"n_bootstrap": 60}},
        {"engine": "causal", "horizon_months": 12, "parameters": {"n_units": 800}},
        {"engine": "microsim", "horizon_months": 12,
         "parameters": {"population_size": 2000, "n_bootstrap": 40}},
        {"engine": "abm", "horizon_months": 12,
         "parameters": {"n_workers": 1500, "n_firms": 200, "n_replications": 8}},
        {"engine": "system_dynamics", "horizon_months": 12,
         "parameters": {"n_monte_carlo": 20}},
        {"engine": "optimization", "parameters": {"budget_ngn_m": 900}},
    ],
    "random_seed": 99,
}


async def _run_to_completion(client: AsyncClient, run_id: str, timeout=60.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        resp = await client.get(f"/v1/scenario-runs/{run_id}")
        data = resp.json()["data"]
        if data["status"] in {"succeeded", "failed", "canceled"}:
            return data
        await asyncio.sleep(0.05)
    raise AssertionError("timeout waiting for run")


def _execute(tmp_path, seeds):
    async def go():
        manager = RunManager(store=ArtifactStore(root=tmp_path))
        await manager.start()
        app.state.runs = manager
        client = AsyncClient(transport=ASGITransport(app=app),
                             base_url="http://test")
        digests = []
        try:
            for seed in seeds:
                scenario = dict(SCENARIO, random_seed=seed)
                resp = await client.post("/v1/scenario-runs", json=scenario)
                assert resp.status_code == 201
                run_id = resp.json()["data"]["simulation_run_id"]
                final = await _run_to_completion(client, run_id)
                assert final["status"] == "succeeded", final.get("error")
                digests.append(results_digest(manager.get_run(run_id)))
        finally:
            await client.aclose()
            await manager.stop()
        return digests
    return asyncio.run(go())


def test_same_seed_same_result_all_engines(tmp_path):
    d1 = _execute(tmp_path / "a", [99])
    d2 = _execute(tmp_path / "b", [99])
    assert d1 == d2, "same seed produced different results"


def test_different_seed_different_result(tmp_path):
    d1 = _execute(tmp_path / "a", [1])
    d2 = _execute(tmp_path / "b", [2])
    assert d1 != d2
