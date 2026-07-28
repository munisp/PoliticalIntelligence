"""OBS-1: ingestion /metrics + domain series."""
from fastapi.testclient import TestClient

from app import metrics
from app.main import app


def test_metrics_endpoint_exposes_required_series():
    metrics.counter("ingestion_records_total").inc({"connector": "test"},
                                                   amount=3)
    metrics.counter("ingestion_runs_total").inc(
        {"connector": "test", "status": "succeeded"})
    client = TestClient(app)
    client.get("/health")
    body = client.get("/metrics")
    assert body.status_code == 200
    text = body.text
    assert "http_request_duration_seconds_bucket" in text
    assert 'service_info{service="ingestion"} 1' in text
    assert 'ingestion_records_total{connector="test"} 3' in text
    assert 'ingestion_runs_total{connector="test",status="succeeded"} 1' in text
