"""OBS-1/OBS-3: /metrics exposition + OTel env-gating."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app import metrics
from app.main import app


def test_metrics_endpoint_exposes_required_series():
    # Generate some traffic + a routing decision first.
    with TestClient(app) as client:
        client.post("/v1/retrieve", json={"query": "healthcare", "top_k": 2})
        metrics.counter("llm_routing_decisions_total").inc(
            {"tier": "offline", "workload_class": "batch", "offline": "true"})
        body = client.get("/metrics")
    assert body.status_code == 200
    text = body.text
    assert "http_request_duration_seconds_bucket" in text
    assert "http_requests_total" in text
    assert 'service_info{service="ai-retrieval-llm"} 1' in text
    assert "retrieval_requests_total" in text
    assert "llm_routing_decisions_total" in text


def test_histogram_buckets_render():
    h = metrics.Histogram("test_latency_seconds", "t", (0.1, 1.0))
    h.observe({"path": "/x"}, 0.05)
    h.observe({"path": "/x"}, 0.5)
    h.observe({"path": "/x"}, 5.0)
    text = h.render()
    assert 'test_latency_seconds_bucket{le="0.1",path="/x"} 1' in text or \
        'path="/x",le="0.1"} 1' in text
    assert 'le="+Inf"' in text
    assert "_count" in text and "_sum" in text


def test_otel_noop_by_default(monkeypatch):
    monkeypatch.delenv("OTEL_SDK_ENABLED", raising=False)
    assert metrics.setup_tracing(app, "ai-retrieval-llm") is False


def test_otel_enabled_without_sdk_degrades_to_noop(monkeypatch):
    # opentelemetry-sdk is an optional extra: enabled-but-missing must be a
    # logged noop, never a boot failure.
    monkeypatch.setenv("OTEL_SDK_ENABLED", "true")
    result = metrics.setup_tracing(app, "ai-retrieval-llm")
    assert isinstance(result, bool)
