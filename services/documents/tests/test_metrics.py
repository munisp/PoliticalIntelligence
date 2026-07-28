"""OBS-1: documents /metrics exposition."""
from fastapi.testclient import TestClient

from app import metrics
from app.main import app


def test_metrics_endpoint_exposes_required_series():
    metrics.counter("documents_processed_total").inc(
        {"status": "succeeded", "doc_type": "act"})
    client = TestClient(app)
    client.get("/health")
    body = client.get("/metrics")
    assert body.status_code == 200
    text = body.text
    assert "http_request_duration_seconds_bucket" in text
    assert 'service_info{service="documents-legal"} 1' in text
    assert "documents_processed_total" in text
