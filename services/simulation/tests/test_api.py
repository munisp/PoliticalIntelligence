"""API lifecycle tests: happy path, idempotency, envelope, errors."""
from __future__ import annotations

import asyncio
import time

from httpx import ASGITransport, AsyncClient

from app.main import app
from app.storage import ArtifactStore
from app.worker import RunManager

SCENARIO = {
    "jurisdiction_id": "jur:ng-kd",
    "assumptions_set": "asm:sme:base",
    "interventions": [{
        "intervention_id": "iv:kd-sme-1",
        "name": "Kaduna SME wage subsidy",
        "sector": "sme",
        "kind": "wage_subsidy",
        "budget_ngn_m": 500.0,
        "target_population": 20000,
        "intensity": 0.6,
        "duration_months": 12,
    }],
    "model_plan": [
        {"engine": "forecast", "horizon_months": 12,
         "parameters": {"n_bootstrap": 50}},
        {"engine": "optimization", "parameters": {"budget_ngn_m": 800}},
    ],
    "random_seed": 42,
}


def make_client(tmp_path):
    manager = RunManager(store=ArtifactStore(root=tmp_path))
    app.state.runs = manager
    return manager, AsyncClient(transport=ASGITransport(app=app),
                                base_url="http://test")


async def _wait_done(client: AsyncClient, run_id: str, timeout: float = 30.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        resp = await client.get(f"/v1/scenario-runs/{run_id}")
        data = resp.json()["data"]
        if data["status"] in {"succeeded", "failed", "canceled"}:
            return data
        await asyncio.sleep(0.05)
    raise AssertionError("run did not finish in time")


def test_health(tmp_path):
    async def go():
        manager, client = await _started(tmp_path)
        try:
            resp = await client.get("/health")
            assert resp.status_code == 200
            assert resp.json()["status"] == "ok"
        finally:
            await client.aclose()
            await manager.stop()
    asyncio.run(go())


async def _started(tmp_path):
    manager, client = make_client(tmp_path)
    await manager.start()
    return manager, client


def test_run_lifecycle_happy_path(tmp_path):
    async def go():
        manager, client = await _started(tmp_path)
        try:
            resp = await client.post("/v1/scenario-runs", json=SCENARIO)
            assert resp.status_code == 201
            body = resp.json()
            assert body["data"]["status"] == "queued"
            assert body["meta"]["api_version"] == "v1"
            assert body["meta"]["request_id"]
            assert "audit" in body and "generated_at" in body["audit"]
            run_id = body["data"]["simulation_run_id"]

            final = await _wait_done(client, run_id)
            assert final["status"] == "succeeded"
            assert final["progress"] == 1.0
            assert final["artifact_links"], "expected artifact links"

            results = await client.get(f"/v1/scenario-runs/{run_id}/results")
            data = results.json()["data"]
            engines = {r["engine"] for r in data["engine_results"]}
            assert engines == {"forecast", "optimization"}
            for r in data["engine_results"]:
                assert r["reproducibility"]["random_seed"] is not None
                assert r["reproducibility"]["seed_data_version"]
            assert data["twin_state_version"] >= 1
        finally:
            await client.aclose()
            await manager.stop()
    asyncio.run(go())


def test_idempotency_key_returns_same_run(tmp_path):
    async def go():
        manager, client = await _started(tmp_path)
        try:
            headers = {"Idempotency-Key": "key-abc-123"}
            r1 = await client.post("/v1/scenario-runs", json=SCENARIO, headers=headers)
            r2 = await client.post("/v1/scenario-runs", json=SCENARIO, headers=headers)
            assert r1.status_code == 201
            assert r2.status_code == 200
            assert r1.json()["data"]["simulation_run_id"] == \
                r2.json()["data"]["simulation_run_id"]
            await _wait_done(client, r1.json()["data"]["simulation_run_id"])
        finally:
            await client.aclose()
            await manager.stop()
    asyncio.run(go())


def test_unknown_jurisdiction_is_422(tmp_path):
    async def go():
        manager, client = await _started(tmp_path)
        try:
            bad = dict(SCENARIO, jurisdiction_id="jur:xx-nope")
            resp = await client.post("/v1/scenario-runs", json=bad)
            assert resp.status_code == 422
            err = resp.json()["error"]
            assert err["code"] == "VALIDATION_ERROR"
            assert err["request_id"]
            assert err["retryable"] is False
        finally:
            await client.aclose()
            await manager.stop()
    asyncio.run(go())


def test_not_found_error_envelope(tmp_path):
    async def go():
        manager, client = await _started(tmp_path)
        try:
            resp = await client.get("/v1/scenario-runs/simrun:missing")
            assert resp.status_code == 404
            assert resp.json()["error"]["code"] == "NOT_FOUND"
        finally:
            await client.aclose()
            await manager.stop()
    asyncio.run(go())


def test_twin_evolves_with_runs(tmp_path):
    async def go():
        manager, client = await _started(tmp_path)
        try:
            r = await client.post("/v1/scenario-runs", json=SCENARIO)
            run_id = r.json()["data"]["simulation_run_id"]
            await _wait_done(client, run_id)
            twin = await client.get("/v1/twins/jur:ng-kd")
            data = twin.json()["data"]
            assert data["version"] >= 1
            assert data["adaptive"]["last_run_id"] == run_id
            assert data["descriptive"]["indicators"]["population"] > 0
        finally:
            await client.aclose()
            await manager.stop()
    asyncio.run(go())
