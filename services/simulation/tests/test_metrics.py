"""OBS-1: simulation /metrics exposition."""
from fastapi.testclient import TestClient

from app.main import app


def test_metrics_endpoint_exposes_required_series():
    client = TestClient(app)
    client.get("/health")
    body = client.get("/metrics")
    assert body.status_code == 200
    text = body.text
    assert "http_request_duration_seconds_bucket" in text
    assert "http_requests_total" in text
    assert 'service_info{service="simulation-engine"} 1' in text
