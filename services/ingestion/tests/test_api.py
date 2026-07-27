"""API tests: envelope shape, job lifecycle, connector status, idempotency."""
import time

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert r.json()["service"] == "ingestion"


def test_connectors_list_envelope(client):
    r = client.get("/v1/connectors")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"data", "meta", "audit"}
    assert body["meta"]["api_version"] == "v1"
    names = {c["name"] for c in body["data"]}
    assert {"worldbank", "hdx", "overpass", "nada", "budeshi",
            "file_harvester"} <= names


def test_unknown_connector_404_error_envelope(client):
    r = client.post("/v1/ingest/nope", json={"jurisdiction": "nga"})
    assert r.status_code == 404
    err = r.json()["error"]
    assert err["code"] == "CONNECTOR_NOT_FOUND"
    assert err["retryable"] is False


def test_ingest_job_lifecycle_and_idempotency(client):
    # worldbank fetch will fail fast offline (no network in tests) — but the
    # job lifecycle (accepted -> terminal state) is what we assert.
    r = client.post(
        "/v1/ingest/worldbank",
        json={"jurisdiction": "nga",
              "params": {"country_iso3": "NGA", "indicators": ["SP.POP.TOTL"]}},
        headers={"Idempotency-Key": "test-key-1"},
    )
    assert r.status_code == 202
    data = r.json()["data"]
    assert data["created"] is True
    job_id = data["job_id"]

    # Idempotent replay returns the same job, not a new one.
    r2 = client.post("/v1/ingest/worldbank", json={"jurisdiction": "nga"},
                     headers={"Idempotency-Key": "test-key-1"})
    assert r2.json()["data"]["job_id"] == job_id
    assert r2.json()["data"]["created"] is False

    # Poll until terminal.
    for _ in range(100):
        s = client.get(f"/v1/ingest/jobs/{job_id}").json()["data"]
        if s["status"] in ("succeeded", "failed"):
            break
        time.sleep(0.05)
    assert s["status"] in ("succeeded", "failed")
    assert s["finished_at"] is not None


def test_job_not_found(client):
    r = client.get("/v1/ingest/jobs/ing_missing")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "JOB_NOT_FOUND"
