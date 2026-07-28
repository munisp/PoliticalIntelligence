"""Indexer: determinism, vector roundtrip, k-NN query path, CLI, scheduler."""
from __future__ import annotations

import json
import threading

import numpy as np
import pytest

from app.llm.embeddings import hashing_embed
from app.retrieval import indexer
from app.retrieval.vector_adapter import VectorAdapter


def _read_rows(path):
    with open(path, "r", encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


def test_reindex_is_deterministic(tmp_path):
    out1 = tmp_path / "a.jsonl"
    out2 = tmp_path / "b.jsonl"
    r1 = indexer.reindex(backend="hashing", out_path=str(out1))
    r2 = indexer.reindex(backend="hashing", out_path=str(out2))
    assert r1["indexed"] == r2["indexed"] > 0
    assert r1["backend"] == "hashing"
    assert out1.read_bytes() == out2.read_bytes()


def test_vector_roundtrip(tmp_path):
    out = tmp_path / "v.jsonl"
    indexer.reindex(backend="hashing", out_path=str(out), batch_size=4)
    rows = _read_rows(out)
    assert rows, "no vectors written"
    row = rows[0]
    assert len(row["embedding"]) == 384
    stored = np.array(row["embedding"], dtype=np.float64)
    live = np.round(hashing_embed(row["content"]), 6)
    assert np.allclose(stored, live, atol=1e-5)
    # Identical text => cosine 1; unit-normalized.
    assert abs(float(stored @ stored) - 1.0) < 1e-3


def test_collect_passages_with_extra_jsonl(tmp_path):
    extra = tmp_path / "extra.jsonl"
    extra.write_text(json.dumps({
        "id": "law:ng-test", "type": "legal", "jurisdiction": "jur:ng-kd",
        "title": "Test Law", "citation": "Test Law 2024",
        "content": "test content about procurement"}) + "\n", encoding="utf-8")
    passages = indexer.collect_passages([str(extra)])
    ids = [p["id"] for p in passages]
    assert "law:ng-test" in ids
    assert len(ids) == len(set(ids)), "dedup by id"


def test_collect_passages_rejects_malformed_jsonl(tmp_path):
    bad = tmp_path / "bad.jsonl"
    bad.write_text(json.dumps({"id": "x"}) + "\n", encoding="utf-8")
    with pytest.raises(ValueError, match="missing keys"):
        indexer.collect_passages([str(bad)])


def test_knn_query_path(monkeypatch):
    """_search_knn issues an OpenSearch k-NN query and maps hits."""
    captured = {}

    class _Resp:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return {"hits": {"hits": [{
                "_id": "abc",
                "_score": 0.91,
                "_source": {
                    "passage_id": "passage:1",
                    "type": "legal",
                    "citation": "Kaduna Law 2024",
                    "content": "public procurement thresholds",
                    "jurisdiction": "jur:ng-kd",
                    "title": "Procurement",
                },
            }]}}

    def fake_post(url, json=None, timeout=None, **kw):
        captured["url"] = url
        captured["body"] = json
        return _Resp()

    monkeypatch.setattr("httpx.post", fake_post)
    import dataclasses
    from app.config import settings
    monkeypatch.setattr("app.retrieval.vector_adapter.settings",
                        dataclasses.replace(settings, opensearch_url="http://opensearch.fake"))
    adapter = VectorAdapter()
    out = adapter._search_knn("procurement thresholds", "jur:ng-kd", {}, 5)
    assert "policy-embeddings/_search" in captured["url"]
    knn = captured["body"]["query"]["knn"]["embedding"]
    assert len(knn["vector"]) == 384
    assert knn["k"] == 5
    assert out[0].evidence_source_id == "passage:1"
    assert out[0].attributes["knn_score"] == 0.91


def test_opensearch_search_prefers_knn_then_falls_back(monkeypatch):
    import dataclasses
    from app.config import settings
    monkeypatch.setattr("app.retrieval.vector_adapter.settings",
                        dataclasses.replace(settings, opensearch_url="http://opensearch.fake"))
    adapter = VectorAdapter()

    def boom(*a, **kw):
        raise RuntimeError("no knn index")

    monkeypatch.setattr(adapter, "_search_knn", boom)

    class _Resp:
        def raise_for_status(self):
            return None

        def json(self):
            return {"hits": {"hits": [{
                "_id": "p1", "_score": 1.2,
                "_source": {"type": "legal", "citation": "c",
                            "content": "x"}}]}}

    monkeypatch.setattr("httpx.post", lambda *a, **kw: _Resp())
    out = adapter._search_opensearch("q", "jur:ng", {}, 3)
    assert out and out[0].evidence_source_id == "p1"


def test_cli_reindex(tmp_path, capsys):
    out = tmp_path / "cli.jsonl"
    rc = indexer.main(["reindex", "--backend", "hashing", "--out", str(out),
                       "--batch-size", "3"])
    assert rc == 0
    summary = json.loads(capsys.readouterr().out)
    assert summary["indexed"] > 0
    assert out.exists()
    assert indexer.main(["bogus"]) == 2


def test_scheduler_hook_runs_and_stops(monkeypatch, tmp_path):
    calls = threading.Event()

    def fake_reindex(**kw):
        calls.set()
        return {"indexed": 1}

    monkeypatch.setattr(indexer, "reindex", fake_reindex)
    thread = indexer.start_index_scheduler(interval_seconds=0.01)
    assert calls.wait(2.0), "scheduled reindex never ran"
    indexer.stop_index_scheduler()
    thread.join(timeout=2.0)
    assert not thread.is_alive()
    indexer._stop.clear()  # reset for other tests
