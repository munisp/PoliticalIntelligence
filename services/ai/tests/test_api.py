"""API tests: envelope shape, endpoints, error envelopes."""
from __future__ import annotations

import asyncio

from httpx import ASGITransport, AsyncClient

from app.llm.router import ModelRouter
from app.main import app
from app.retrieval.fusion import HybridRetriever


def _client():
    app.state.retriever = HybridRetriever()
    app.state.router = ModelRouter(base_url=None)  # deterministic offline
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


def _run(coro):
    return asyncio.run(coro)


def test_health():
    async def go():
        async with _client() as c:
            resp = await c.get("/health")
            assert resp.status_code == 200
            body = resp.json()
            assert body["status"] == "ok"
            assert body["llm_mode"] == "offline-synthesizer"
            assert body["adapter_modes"]["vector"] == "tfidf-fallback"
    _run(go())


def test_retrieve_envelope_shape():
    async def go():
        async with _client() as c:
            resp = await c.post("/v1/retrieve", json={
                "query": "teacher licensing education",
                "jurisdiction_id": "jur:ng-kd", "top_k": 6})
            assert resp.status_code == 200
            body = resp.json()
            assert set(body) == {"data", "meta", "audit"}
            assert body["meta"]["api_version"] == "v1"
            assert body["meta"]["request_id"]
            assert body["meta"]["correlation_id"]
            assert body["audit"]["actor_id"] == "anonymous"
            assert body["audit"]["generated_at"]
            data = body["data"]
            assert data["bundle_id"].startswith("evb:")
            assert len(data["evidence"]) <= 6
            for ev in data["evidence"]:
                assert set(ev) >= {"evidence_source_id", "source_type",
                                   "citation", "retrieval_path",
                                   "confidence", "content"}
    _run(go())


def test_request_id_propagated():
    async def go():
        async with _client() as c:
            resp = await c.post("/v1/retrieve",
                                json={"query": "sme credit"},
                                headers={"X-Request-ID": "req-xyz",
                                         "X-Actor-ID": "analyst-7"})
            body = resp.json()
            assert body["meta"]["request_id"] == "req-xyz"
            assert body["meta"]["correlation_id"] == "req-xyz"
            assert body["audit"]["actor_id"] == "analyst-7"
    _run(go())


def test_recommendations_endpoint_offline_contract():
    async def go():
        async with _client() as c:
            resp = await c.post("/v1/recommendations", json={
                "query": "create jobs through teacher hiring and school meals",
                "jurisdiction_id": "jur:ng-kd", "sector": "education",
                "workload_class": "premium_synthesis"})
            assert resp.status_code == 200
            rec = resp.json()["data"]
            for field in ("rationale", "assumptions", "evidence_base",
                          "estimated_jobs", "budget_ranges", "timeline",
                          "implementation_actors", "legal_dependencies",
                          "risk_register", "kpis", "simulation_scenarios",
                          "model_routing", "confidence"):
                assert field in rec, f"missing contract field {field}"
            assert rec["model_routing"]["offline"] is True
            assert rec["model_routing"]["workload_class"] == "premium_synthesis"
            assert rec["estimated_jobs"] > 0
    _run(go())


def test_copilot_query_citations_and_uncertainty():
    async def go():
        async with _client() as c:
            resp = await c.post("/v1/copilot/query", json={
                "query": "what does the procurement act require?",
                "jurisdiction_id": "jur:ng"})
            assert resp.status_code == 200
            data = resp.json()["data"]
            assert data["answer"]
            assert data["citations"], "SR-8 citation requirement"
            assert data["uncertainty"] in {"low", "medium", "high"}
            assert data["model_routing"]["queue"] == "interactive"
    _run(go())


def test_routing_audit_endpoint_records_decisions():
    async def go():
        async with _client() as c:
            await c.post("/v1/copilot/query",
                         json={"query": "education evidence"})
            resp = await c.get("/v1/routing/audit")
            assert resp.status_code == 200
            data = resp.json()["data"]
            assert data["count"] >= 1
            entry = data["entries"][-1]
            assert entry["workload_class"] == "interactive_copilot"
            assert entry["queue"] == "interactive"
            assert entry["offline"] is True
            assert entry["decision_id"]
    _run(go())


def test_validation_error_envelope():
    async def go():
        async with _client() as c:
            resp = await c.post("/v1/retrieve", json={"query": ""})
            assert resp.status_code == 422
            err = resp.json()["error"]
            assert err["code"] == "VALIDATION_ERROR"
            assert err["request_id"]
            assert err["retryable"] is False
            assert "details" in err
    _run(go())
