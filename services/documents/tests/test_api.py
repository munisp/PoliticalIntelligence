"""End-to-end API tests: upload → pipeline → artifacts, quality, review
routing, idempotency (spec §18)."""
from __future__ import annotations

import json
import time

import pytest
from fastapi.testclient import TestClient

from app.main import app

from .fixtures import PPA_EXCERPT, make_scanned_png, make_text_pdf

LINES = [ln for ln in PPA_EXCERPT.splitlines() if ln.strip()]


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    import os
    os.environ["DOCUMENTS_ARTIFACTS_DIR"] = str(
        tmp_path_factory.mktemp("artifacts"))
    with TestClient(app) as c:
        yield c


def _wait_done(client: TestClient, document_id: str, timeout: float = 15.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/v1/documents/{document_id}").json()["data"]
        if job["status"] in ("succeeded", "failed"):
            return job
        time.sleep(0.05)
    raise AssertionError("pipeline did not finish in time")


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_upload_pipeline_happy_path(client):
    r = client.post(
        "/v1/documents",
        files={"file": ("ppa.pdf", make_text_pdf(LINES), "application/pdf")},
        data={"title": "Public Procurement Act", "jurisdiction_id": "jur:ng",
              "doc_type": "act"},
        headers={"Idempotency-Key": "test-ppa-upload-0001"},
    )
    assert r.status_code == 202
    body = r.json()
    assert body["data"]["created"] is True
    document_id = body["data"]["document_id"]

    job = _wait_done(client, document_id)
    assert job["status"] == "succeeded", job.get("error")
    stages = {s["name"]: s["status"] for s in job["stages"]}
    assert set(stages) == {"upload", "extract", "segment", "legal_nlp",
                           "structure", "review_routing"}
    assert all(s == "succeeded" for s in stages.values())
    assert set(job["artifacts"]) >= {"raw", "ocr", "clauses", "edges",
                                     "akn", "quality"}
    assert job["ocr_confidence"] > 0.8

    # clauses artifact
    clauses = json.loads(client.get(
        f"/v1/documents/{document_id}/artifacts/clauses").content)
    assert any(c["section_path"] == "s.16" for c in clauses)
    s16 = next(c for c in clauses if c["section_path"] == "s.16")
    assert any(cit["relation"] == "AMENDS" for cit in s16["citations"])

    # AKN artifact is structurally valid
    akn_xml = client.get(
        f"/v1/documents/{document_id}/artifacts/akn").content.decode()
    from app.akn import structural_check
    assert structural_check(akn_xml) == []
    assert "/akn/ng/act/2007/ppa" in akn_xml

    # quality report
    quality = client.get(f"/v1/documents/{document_id}/quality").json()["data"]
    assert quality["clause_count"] >= 5
    assert quality["obligation_count"] >= 3
    assert quality["citation_count"] >= 2
    assert quality["mean_ocr_confidence"] > 0.8
    assert quality["low_confidence_pages"] == []


def test_idempotency_returns_same_job(client):
    payload = dict(files={"file": ("a.txt", PPA_EXCERPT.encode(), "text/plain")},
                   data={"title": "Idem Test"},
                   headers={"Idempotency-Key": "idem-key-0001"})
    r1 = client.post("/v1/documents", **payload).json()["data"]
    r2 = client.post("/v1/documents", **payload).json()["data"]
    assert r1["job_id"] == r2["job_id"]
    assert r2["created"] is False


def test_low_confidence_review_routing(client):
    r = client.post(
        "/v1/documents",
        files={"file": ("scan.png", make_scanned_png(LINES), "image/png")},
        data={"title": "Scanned Gazette"},
        headers={"Idempotency-Key": "scan-review-0001"},
    )
    document_id = r.json()["data"]["document_id"]
    job = _wait_done(client, document_id)
    assert job["status"] == "succeeded"
    quality = client.get(f"/v1/documents/{document_id}/quality").json()["data"]
    if quality["backend_used"] == "paddle-fallback":
        # BR-4: embedded text layer at 0.6 confidence -> review flag
        assert quality["low_confidence_pages"] == [1]
        assert any(f["type"] == "ocr_low_confidence"
                   for f in quality["review_flags"])


def test_reprocess(client):
    r = client.post(
        "/v1/documents",
        files={"file": ("b.txt", PPA_EXCERPT.encode(), "text/plain")},
        data={"title": "Reprocess Me"},
        headers={"Idempotency-Key": "reprocess-0001"},
    )
    document_id = r.json()["data"]["document_id"]
    _wait_done(client, document_id)
    r2 = client.post(f"/v1/documents/{document_id}/reprocess")
    assert r2.status_code == 202
    job = _wait_done(client, document_id)
    assert job["status"] == "succeeded"
    quality = client.get(f"/v1/documents/{document_id}/quality").json()["data"]
    assert quality["clause_count"] >= 5


def test_document_not_found(client):
    r = client.get("/v1/documents/doc:missing")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "DOCUMENT_NOT_FOUND"


def test_empty_upload_rejected(client):
    r = client.post("/v1/documents",
                    files={"file": ("empty.txt", b"", "text/plain")},
                    data={"title": "Empty"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "EMPTY_UPLOAD"
